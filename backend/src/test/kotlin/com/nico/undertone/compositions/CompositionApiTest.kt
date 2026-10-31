package com.nico.undertone.compositions

import com.jayway.jsonpath.JsonPath
import com.nico.undertone.IntegrationTest
import com.nico.undertone.TestImages
import com.nico.undertone.images.ImageService
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.delete
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CompositionApiTest : IntegrationTest() {

    @Autowired
    lateinit var images: ImageService

    private fun uploadImage(): String {
        val result = mockMvc.post("/api/images") {
            contentType = MediaType.IMAGE_PNG
            content = TestImages.png(seed = 1000 + seeds.incrementAndGet())
        }.andExpect { status { isCreated() } }.andReturn()
        return JsonPath.read(result.response.contentAsString, "$.id")
    }

    private fun piece(name: String, original: String, cutout: String? = null, shown: String = "original", x: Double = 100.0) =
        """{"name":"$name","originalImageId":"$original","cutoutImageId":${cutout?.let { "\"$it\"" } ?: "null"},
            "shown":"$shown","x":$x,"y":50.5,"width":240.0,"ratio":0.75}"""

    private fun body(title: String, vararg pieces: String) = """{"title":"$title","pieces":[${pieces.joinToString(",")}]}"""

    private fun create(json: String): String {
        val result = mockMvc.post("/api/compositions") { contentType = MediaType.APPLICATION_JSON; content = json }
            .andExpect { status { isCreated() } }.andReturn()
        return JsonPath.read(result.response.contentAsString, "$.id")
    }

    private fun imageFileExists(id: String): Boolean {
        val image = images.find(UUID.fromString(id)) ?: return false
        return Files.exists(images.fileOf(image))
    }

    @Test
    fun `saves and reopens a composition exactly`() {
        val shirt = uploadImage()
        val shoe = uploadImage()
        val shoeCutout = uploadImage()

        val id = create(body("Grey Saturday", piece("shirt.jpg", shirt), piece("shoe.png", shoe, shoeCutout, "cutout", x = 612.25)))

        mockMvc.get("/api/compositions/$id").andExpect {
            status { isOk() }
            jsonPath("$.title") { value("Grey Saturday") }
            jsonPath("$.createdAt") { exists() }
            jsonPath("$.pieces.length()") { value(2) }
            jsonPath("$.pieces[0].name") { value("shirt.jpg") }
            jsonPath("$.pieces[0].originalImageId") { value(shirt) }
            jsonPath("$.pieces[0].cutoutImageId") { value(null) }
            jsonPath("$.pieces[0].shown") { value("original") }
            jsonPath("$.pieces[1].cutoutImageId") { value(shoeCutout) }
            jsonPath("$.pieces[1].shown") { value("cutout") }
            jsonPath("$.pieces[1].x") { value(612.25) }
            jsonPath("$.pieces[1].y") { value(50.5) }
            jsonPath("$.pieces[1].width") { value(240.0) }
            jsonPath("$.pieces[1].ratio") { value(0.75) }
        }
        val list = mockMvc.get("/api/compositions").andExpect { status { isOk() } }.andReturn().response.contentAsString
        val ids = JsonPath.read<List<String>>(list, "$[*].id")
        val titles = JsonPath.read<List<String>>(list, "$[*].title")
        assertTrue(id in ids)
        assertEquals("Grey Saturday", titles[ids.indexOf(id)])
    }

    @Test
    fun `update replaces title, pieces and layer order, and drops unused images`() {
        val a = uploadImage()
        val b = uploadImage()
        val dropped = uploadImage()
        val id = create(body("First", piece("a", a), piece("b", b), piece("dropped", dropped)))

        mockMvc.put("/api/compositions/$id") {
            contentType = MediaType.APPLICATION_JSON
            content = body("Second", piece("b", b), piece("a", a))
        }.andExpect {
            status { isOk() }
            jsonPath("$.title") { value("Second") }
            jsonPath("$.pieces[0].name") { value("b") }
            jsonPath("$.pieces[1].name") { value("a") }
        }

        assertTrue(imageFileExists(a))
        assertNull(images.find(UUID.fromString(dropped)))
        mockMvc.get("/api/images/$dropped").andExpect { status { isNotFound() } }
    }

    @Test
    fun `delete removes the composition and only images nobody else uses`() {
        val shared = uploadImage()
        val own = uploadImage()
        val ownFile = images.fileOf(images.find(UUID.fromString(own))!!)
        val keep = create(body("Keep", piece("shared", shared)))
        val gone = create(body("Gone", piece("shared", shared), piece("own", own)))

        mockMvc.delete("/api/compositions/$gone").andExpect { status { isNoContent() } }

        mockMvc.get("/api/compositions/$gone").andExpect { status { isNotFound() } }
        mockMvc.get("/api/compositions/$keep").andExpect { status { isOk() } }
        assertTrue(imageFileExists(shared))
        assertNull(images.find(UUID.fromString(own)))
        assertFalse(Files.exists(ownFile))
    }

    @Test
    fun `rejects invalid compositions`() {
        val image = uploadImage()
        val invalid = listOf(
            body("  ", piece("a", image)),
            body("No pieces"),
            body("Unknown image", piece("a", UUID.randomUUID().toString())),
            body("Cutout missing", piece("a", image, shown = "cutout")),
            body("Bad shown", piece("a", image, shown = "both")),
            body("x".repeat(121), piece("a", image)),
            """{"title":"Broken","pieces":[{"name":"a"}]}""",
            "not json",
        )
        for (json in invalid) {
            mockMvc.post("/api/compositions") { contentType = MediaType.APPLICATION_JSON; content = json }
                .andExpect { status { isBadRequest() } }
        }
        assertNotNull(images.find(UUID.fromString(image)))
    }

    @Test
    fun `unknown compositions return 404`() {
        val image = uploadImage()
        val missing = UUID.randomUUID()
        mockMvc.get("/api/compositions/$missing").andExpect { status { isNotFound() } }
        mockMvc.put("/api/compositions/$missing") {
            contentType = MediaType.APPLICATION_JSON
            content = body("Nope", piece("a", image))
        }.andExpect { status { isNotFound() } }
        mockMvc.delete("/api/compositions/$missing").andExpect { status { isNotFound() } }
    }

    @Test
    fun `blank piece names get a fallback`() {
        val image = uploadImage()
        val id = create(body("Names", piece("  ", image)))
        mockMvc.get("/api/compositions/$id").andExpect { jsonPath("$.pieces[0].name") { value("Untitled piece") } }
    }

    companion object {
        private val seeds = AtomicInteger()
    }
}

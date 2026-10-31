package com.nico.undertone.images

import com.jayway.jsonpath.JsonPath
import com.nico.undertone.IntegrationTest
import com.nico.undertone.TestImages
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import java.nio.file.Files
import java.util.UUID
import kotlin.test.assertEquals

class ImageApiTest : IntegrationTest() {

    @Autowired
    lateinit var images: ImageService

    private fun upload(bytes: ByteArray, type: MediaType = MediaType.IMAGE_PNG) =
        mockMvc.post("/api/images") { contentType = type; content = bytes }

    @Test
    fun `stores an image and serves the same bytes`() {
        val png = TestImages.png(seed = 1)
        val result = upload(png).andExpect {
            status { isCreated() }
            header { exists("Location") }
            jsonPath("$.contentType") { value("image/png") }
            jsonPath("$.width") { value(40) }
            jsonPath("$.height") { value(30) }
            jsonPath("$.sizeBytes") { value(png.size) }
        }.andReturn()
        val id = JsonPath.read<String>(result.response.contentAsString, "$.id")

        mockMvc.get("/api/images/$id").andExpect {
            status { isOk() }
            content { contentType("image/png") }
            content { bytes(png) }
            header { string("Cache-Control", "public, max-age=31536000, immutable") }
        }
    }

    @Test
    fun `identical bytes are stored once`() {
        val png = TestImages.png(seed = 2)
        val first = upload(png).andExpect { status { isCreated() } }.andReturn()
        val second = upload(png).andExpect { status { isOk() } }.andReturn()

        val id = JsonPath.read<String>(first.response.contentAsString, "$.id")
        assertEquals(id, JsonPath.read<String>(second.response.contentAsString, "$.id"))

        val hash = images.find(UUID.fromString(id))!!.hash
        val files = Files.list(images.directory).use { stream -> stream.filter { it.fileName.toString().startsWith(hash) }.count() }
        assertEquals(1, files)
    }

    @Test
    fun `detects the format from the bytes, not the header`() {
        upload(TestImages.webpExtended, MediaType.APPLICATION_OCTET_STREAM).andExpect {
            status { isCreated() }
            jsonPath("$.contentType") { value("image/webp") }
            jsonPath("$.width") { value(12) }
            jsonPath("$.height") { value(7) }
        }
        upload(TestImages.jpeg(seed = 3), MediaType.IMAGE_PNG).andExpect {
            jsonPath("$.contentType") { value("image/jpeg") }
        }
    }

    @Test
    fun `rejects empty and non-image uploads`() {
        upload(ByteArray(0)).andExpect { status { isBadRequest() } }
        upload("not an image".toByteArray()).andExpect { status { isUnsupportedMediaType() } }
    }

    @Test
    fun `unknown and malformed ids`() {
        mockMvc.get("/api/images/${UUID.randomUUID()}").andExpect { status { isNotFound() } }
        mockMvc.get("/api/images/not-a-uuid").andExpect { status { isBadRequest() } }
    }
}

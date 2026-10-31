package com.nico.undertone.images

import org.springframework.core.io.FileSystemResource
import org.springframework.core.io.Resource
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.net.URI
import java.nio.file.Files
import java.util.UUID

data class ImageResponse(
    val id: UUID,
    val contentType: String,
    val width: Int,
    val height: Int,
    val sizeBytes: Long,
)

@RestController
@RequestMapping("/api/images")
class ImageController(private val service: ImageService) {

    /** Raw image bytes as the request body. 201 for a new image, 200 when the same bytes already exist. */
    @PostMapping
    fun upload(@RequestBody(required = false) bytes: ByteArray?): ResponseEntity<ImageResponse> {
        val (image, created) = service.store(bytes ?: ByteArray(0))
        val body = image.toResponse()
        return if (created) ResponseEntity.created(URI.create("/api/images/${image.id}")).body(body)
        else ResponseEntity.ok(body)
    }

    @GetMapping("/{id}")
    fun download(@PathVariable id: UUID): ResponseEntity<Resource> {
        val image = service.find(id) ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Image not found.")
        val file = service.fileOf(image)
        if (!Files.isRegularFile(file)) throw ResponseStatusException(HttpStatus.NOT_FOUND, "Image file is missing.")
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(image.contentType))
            // Content-addressed: the bytes behind an id never change.
            .header(HttpHeaders.CACHE_CONTROL, "public, max-age=31536000, immutable")
            .body(FileSystemResource(file))
    }

    private fun ImageRecord.toResponse() = ImageResponse(id, contentType, width, height, sizeBytes)
}

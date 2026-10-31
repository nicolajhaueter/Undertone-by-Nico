package com.nico.undertone.compositions

import com.nico.undertone.images.ImageRepository
import com.nico.undertone.images.ImageService
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import java.util.UUID

@Service
@Transactional
class CompositionService(
    private val compositions: CompositionRepository,
    private val imageRepository: ImageRepository,
    private val images: ImageService,
) {

    @Transactional(readOnly = true)
    fun list(): List<CompositionResponse> = compositions.findAll()

    @Transactional(readOnly = true)
    fun get(id: UUID): CompositionResponse = compositions.find(id) ?: notFound()

    fun create(request: CompositionRequest): CompositionResponse {
        val valid = validate(request)
        val id = UUID.randomUUID()
        compositions.insert(id, valid.title)
        compositions.replacePieces(id, valid.pieces)
        return compositions.find(id)!!
    }

    fun update(id: UUID, request: CompositionRequest): CompositionResponse {
        if (!compositions.exists(id)) notFound()
        val valid = validate(request)
        val before = compositions.imageIdsOf(id)
        compositions.updateTitle(id, valid.title)
        compositions.replacePieces(id, valid.pieces)
        images.deleteUnreferenced(before)
        return compositions.find(id)!!
    }

    fun delete(id: UUID) {
        val before = compositions.imageIdsOf(id)
        if (!compositions.delete(id)) notFound()
        images.deleteUnreferenced(before)
    }

    private fun validate(request: CompositionRequest): CompositionRequest {
        val title = request.title.trim()
        if (title.isEmpty()) badRequest("Give the composition a title.")
        if (title.length > MAX_TITLE) badRequest("Titles can be at most $MAX_TITLE characters.")
        if (request.pieces.isEmpty()) badRequest("A composition needs at least one piece.")
        if (request.pieces.size > MAX_PIECES) badRequest("A composition can hold at most $MAX_PIECES pieces.")

        val pieces = request.pieces.mapIndexed { index, piece ->
            val label = "Piece ${index + 1}"
            if (piece.shown != "original" && piece.shown != "cutout") badRequest("$label: shown must be original or cutout.")
            if (piece.shown == "cutout" && piece.cutoutImageId == null) badRequest("$label shows a cutout but has none.")
            if (listOf(piece.x, piece.y, piece.width, piece.ratio).any { !it.isFinite() }) badRequest("$label has an invalid position or size.")
            if (piece.width <= 0 || piece.ratio <= 0) badRequest("$label needs a positive size.")
            piece.copy(name = piece.name.trim().ifEmpty { "Untitled piece" }.take(MAX_NAME))
        }

        val referenced = pieces.flatMap { listOfNotNull(it.originalImageId, it.cutoutImageId) }.toSet()
        val missing = referenced - imageRepository.existingIds(referenced)
        if (missing.isNotEmpty()) badRequest("Unknown image: ${missing.first()}. Upload it before saving.")

        return CompositionRequest(title, pieces)
    }

    private fun notFound(): Nothing = throw ResponseStatusException(HttpStatus.NOT_FOUND, "Composition not found.")
    private fun badRequest(message: String): Nothing = throw ResponseStatusException(HttpStatus.BAD_REQUEST, message)

    companion object {
        const val MAX_TITLE = 120
        const val MAX_NAME = 255
        const val MAX_PIECES = 200
    }
}

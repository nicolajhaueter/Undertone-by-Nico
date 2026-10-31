package com.nico.undertone.compositions

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.sql.Types
import java.time.OffsetDateTime
import java.util.UUID

@Repository
class CompositionRepository(private val jdbc: JdbcClient) {

    private data class Header(val id: UUID, val title: String, val createdAt: OffsetDateTime, val updatedAt: OffsetDateTime)

    fun findAll(): List<CompositionResponse> {
        val headers = jdbc.sql("select * from compositions order by updated_at desc, created_at desc")
            .query { rs, _ -> header(rs) }.list()
        val pieces = jdbc.sql("select * from composition_pieces order by composition_id, layer_index")
            .query { rs, _ -> rs.getObject("composition_id", UUID::class.java) to piece(rs) }.list()
            .groupBy({ it.first }, { it.second })
        return headers.map { it.toResponse(pieces[it.id].orEmpty()) }
    }

    fun find(id: UUID): CompositionResponse? {
        val header = jdbc.sql("select * from compositions where id = :id").param("id", id)
            .query { rs, _ -> header(rs) }.optional().orElse(null) ?: return null
        return header.toResponse(piecesOf(id))
    }

    fun exists(id: UUID): Boolean =
        jdbc.sql("select count(*) from compositions where id = :id").param("id", id).query(Long::class.javaObjectType).single() > 0

    fun insert(id: UUID, title: String) {
        jdbc.sql("insert into compositions (id, title) values (:id, :title)")
            .param("id", id).param("title", title).update()
    }

    fun updateTitle(id: UUID, title: String) {
        jdbc.sql("update compositions set title = :title, updated_at = now() where id = :id")
            .param("id", id).param("title", title).update()
    }

    fun delete(id: UUID): Boolean =
        jdbc.sql("delete from compositions where id = :id").param("id", id).update() > 0

    fun replacePieces(compositionId: UUID, pieces: List<PieceDto>) {
        jdbc.sql("delete from composition_pieces where composition_id = :id").param("id", compositionId).update()
        pieces.forEachIndexed { layer, piece ->
            jdbc.sql(
                """
                insert into composition_pieces
                    (composition_id, layer_index, name, original_image_id, cutout_image_id, shown, x, y, width, ratio)
                values (:compositionId, :layer, :name, :original, :cutout, :shown, :x, :y, :width, :ratio)
                """
            )
                .param("compositionId", compositionId)
                .param("layer", layer)
                .param("name", piece.name)
                .param("original", piece.originalImageId)
                .param("cutout", piece.cutoutImageId, Types.OTHER)
                .param("shown", piece.shown)
                .param("x", piece.x)
                .param("y", piece.y)
                .param("width", piece.width)
                .param("ratio", piece.ratio)
                .update()
        }
    }

    /** Every image id (original or cutout) the composition currently references. */
    fun imageIdsOf(compositionId: UUID): Set<UUID> =
        piecesOf(compositionId).flatMap { listOfNotNull(it.originalImageId, it.cutoutImageId) }.toSet()

    private fun piecesOf(id: UUID): List<PieceDto> =
        jdbc.sql("select * from composition_pieces where composition_id = :id order by layer_index")
            .param("id", id).query { rs, _ -> piece(rs) }.list()

    private fun header(rs: ResultSet) = Header(
        id = rs.getObject("id", UUID::class.java),
        title = rs.getString("title"),
        createdAt = rs.getObject("created_at", OffsetDateTime::class.java),
        updatedAt = rs.getObject("updated_at", OffsetDateTime::class.java),
    )

    private fun piece(rs: ResultSet) = PieceDto(
        name = rs.getString("name"),
        originalImageId = rs.getObject("original_image_id", UUID::class.java),
        cutoutImageId = rs.getObject("cutout_image_id", UUID::class.java),
        shown = rs.getString("shown"),
        x = rs.getDouble("x"),
        y = rs.getDouble("y"),
        width = rs.getDouble("width"),
        ratio = rs.getDouble("ratio"),
    )

    private fun Header.toResponse(pieces: List<PieceDto>) =
        CompositionResponse(id, title, createdAt.toInstant(), updatedAt.toInstant(), pieces)
}

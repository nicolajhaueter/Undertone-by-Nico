package com.nico.undertone.images

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import java.sql.ResultSet
import java.util.UUID

data class ImageRecord(
    val id: UUID,
    val hash: String,
    val fileName: String,
    val contentType: String,
    val width: Int,
    val height: Int,
    val sizeBytes: Long,
)

@Repository
class ImageRepository(private val jdbc: JdbcClient) {

    fun findById(id: UUID): ImageRecord? =
        jdbc.sql("select * from images where id = :id").param("id", id).query { rs, _ -> map(rs) }.optional().orElse(null)

    fun findByHash(hash: String): ImageRecord? =
        jdbc.sql("select * from images where hash = :hash").param("hash", hash).query { rs, _ -> map(rs) }.optional().orElse(null)

    fun existingIds(ids: Collection<UUID>): Set<UUID> =
        if (ids.isEmpty()) emptySet()
        else jdbc.sql("select id from images where id in (:ids)").param("ids", ids)
            .query { rs, _ -> rs.getObject("id", UUID::class.java) }.set()

    fun insert(image: ImageRecord) {
        jdbc.sql(
            """
            insert into images (id, hash, file_name, content_type, width, height, size_bytes)
            values (:id, :hash, :fileName, :contentType, :width, :height, :sizeBytes)
            """
        )
            .param("id", image.id)
            .param("hash", image.hash)
            .param("fileName", image.fileName)
            .param("contentType", image.contentType)
            .param("width", image.width)
            .param("height", image.height)
            .param("sizeBytes", image.sizeBytes)
            .update()
    }

    /**
     * Deletes those of [ids] that no composition piece references any more and
     * returns their file names. Referenced images are left untouched.
     */
    fun deleteUnreferenced(ids: Collection<UUID>): List<String> =
        if (ids.isEmpty()) emptyList()
        else jdbc.sql(
            """
            delete from images i
            where i.id in (:ids)
              and not exists (
                select 1 from composition_pieces p
                where p.original_image_id = i.id or p.cutout_image_id = i.id
              )
            returning i.file_name
            """
        ).param("ids", ids).query { rs, _ -> rs.getString("file_name") }.list()

    private fun map(rs: ResultSet) = ImageRecord(
        id = rs.getObject("id", UUID::class.java),
        hash = rs.getString("hash"),
        fileName = rs.getString("file_name"),
        contentType = rs.getString("content_type"),
        width = rs.getInt("width"),
        height = rs.getInt("height"),
        sizeBytes = rs.getLong("size_bytes"),
    )
}

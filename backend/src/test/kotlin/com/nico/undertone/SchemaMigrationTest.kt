package com.nico.undertone

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.jdbc.core.simple.JdbcClient
import kotlin.test.assertEquals

class SchemaMigrationTest : IntegrationTest() {

    @Autowired
    lateinit var jdbc: JdbcClient

    @Test
    fun `flyway creates the composition schema`() {
        val tables = jdbc.sql(
            """
            select table_name from information_schema.tables
            where table_schema = 'public' and table_name in ('images', 'compositions', 'composition_pieces')
            order by table_name
            """
        ).query { rs, _ -> rs.getString("table_name") }.list()

        assertEquals(listOf("composition_pieces", "compositions", "images"), tables)
    }

    @Test
    fun `postgres is version 17`() {
        val version = jdbc.sql("show server_version").query { rs, _ -> rs.getString(1) }.single()
        assertEquals("17", version.substringBefore('.'))
    }
}

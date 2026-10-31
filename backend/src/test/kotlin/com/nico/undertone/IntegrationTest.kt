package com.nico.undertone

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.test.web.servlet.MockMvc

/**
 * Base for tests that need the real database. All subclasses share one
 * Spring context, so a single PostgreSQL container serves the whole run.
 */
@SpringBootTest(properties = ["undertone.images.dir=\${java.io.tmpdir}/undertone-test-images/\${random.uuid}"])
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
abstract class IntegrationTest {

    @Autowired
    lateinit var mockMvc: MockMvc
}

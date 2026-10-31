package com.nico.undertone

import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import

/**
 * Base for tests that need the real database. All subclasses share one
 * Spring context, so a single PostgreSQL container serves the whole run.
 */
@SpringBootTest(properties = ["undertone.images.dir=\${java.io.tmpdir}/undertone-test-images/\${random.uuid}"])
@Import(TestcontainersConfiguration::class)
abstract class IntegrationTest

package com.nico.undertone

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class StatusController {

    @GetMapping("/api/status")
    fun status(): Map<String, String> = mapOf(
        "name" to "Undertone by Nico",
        "status" to "running"
    )
}
package com.nico.undertone.compositions

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.util.UUID

@RestController
@RequestMapping("/api/compositions")
class CompositionController(private val service: CompositionService) {

    /** Newest first, with pieces, so Archive can draw previews without extra requests. */
    @GetMapping
    fun list(): List<CompositionResponse> = service.list()

    @GetMapping("/{id}")
    fun get(@PathVariable id: UUID): CompositionResponse = service.get(id)

    @PostMapping
    fun create(@RequestBody request: CompositionRequest): ResponseEntity<CompositionResponse> {
        val created = service.create(request)
        return ResponseEntity.created(URI.create("/api/compositions/${created.id}")).body(created)
    }

    @PutMapping("/{id}")
    fun update(@PathVariable id: UUID, @RequestBody request: CompositionRequest): CompositionResponse =
        service.update(id, request)

    @DeleteMapping("/{id}")
    fun delete(@PathVariable id: UUID): ResponseEntity<Void> {
        service.delete(id)
        return ResponseEntity.noContent().build()
    }
}

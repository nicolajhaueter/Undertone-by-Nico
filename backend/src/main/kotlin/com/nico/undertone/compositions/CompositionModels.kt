package com.nico.undertone.compositions

import java.time.Instant
import java.util.UUID

/**
 * One placed image. Coordinates use the Studio board's fixed 1000 x 700 space;
 * list order is layer order (first = back).
 */
data class PieceDto(
    val name: String,
    val originalImageId: UUID,
    val cutoutImageId: UUID? = null,
    /** "original" or "cutout" — which version the composition shows. */
    val shown: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val ratio: Double,
)

data class CompositionRequest(
    val title: String,
    val pieces: List<PieceDto>,
)

data class CompositionResponse(
    val id: UUID,
    val title: String,
    val createdAt: Instant,
    val updatedAt: Instant,
    val pieces: List<PieceDto>,
)

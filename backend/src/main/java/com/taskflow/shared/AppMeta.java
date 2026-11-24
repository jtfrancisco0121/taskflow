package com.taskflow.shared;

import io.swagger.v3.oas.annotations.media.Schema;

/** Public description of the running application, returned by {@code GET /api/v1/meta}. */
public record AppMeta(
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
    @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String version) {}

package com.taskflow.shared.internal;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Fixed title, version and server so the generated spec does not depend on port or build. */
@Configuration
class OpenApiConfig {

  @Bean
  OpenAPI taskflowOpenApi() {
    return new OpenAPI()
        .info(new Info().title("Taskflow API").version("v1"))
        .servers(List.of(new Server().url("/")));
  }
}

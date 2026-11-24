package com.taskflow.shared.internal;

import com.taskflow.shared.AppMeta;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class MetaController {

  private final String version;

  MetaController(ObjectProvider<BuildProperties> buildProperties) {
    BuildProperties build = buildProperties.getIfAvailable();
    this.version = build != null && build.getVersion() != null ? build.getVersion() : "dev";
  }

  @GetMapping(value = "/meta", produces = MediaType.APPLICATION_JSON_VALUE)
  AppMeta meta() {
    return new AppMeta("taskflow", version);
  }
}

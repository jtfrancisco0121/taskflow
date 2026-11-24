package com.taskflow.identity.internal;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/**
 * Publishes the access-token decoder as a Spring bean (decision 004). The STOMP gateway in {@code
 * realtime} injects the Spring type, so it needs no dependency on this module.
 */
@Configuration
@EnableConfigurationProperties(JwtProperties.class)
class JwtConfig {

  @Bean
  JwtDecoder jwtDecoder(JwtProperties properties) {
    return JwtService.decoder(properties);
  }
}

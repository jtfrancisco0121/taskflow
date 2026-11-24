package com.taskflow.shared.internal;

import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class ClientIdConfig {

  /** Before the idempotency filter (order 0), which runs the controller in its own transaction. */
  @Bean
  FilterRegistrationBean<ClientIdFilter> clientIdFilter() {
    FilterRegistrationBean<ClientIdFilter> registration =
        new FilterRegistrationBean<>(new ClientIdFilter());
    registration.addUrlPatterns("/api/v1/*");
    registration.setOrder(-50);
    return registration;
  }
}

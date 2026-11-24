package com.taskflow.shared.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.ProblemResponseWriter;
import jakarta.persistence.EntityManager;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

@Configuration
class IdempotencyConfig {

  /** Runs after the Spring Security chain (order -100), so the actor is known. */
  @Bean
  FilterRegistrationBean<IdempotencyFilter> idempotencyFilter(
      PlatformTransactionManager transactionManager,
      JdbcTemplate jdbc,
      EntityManager em,
      @Qualifier("requestMappingHandlerMapping")
          ObjectProvider<RequestMappingHandlerMapping> mapping,
      ProblemResponseWriter problems,
      ObjectMapper mapper) {
    FilterRegistrationBean<IdempotencyFilter> registration =
        new FilterRegistrationBean<>(
            new IdempotencyFilter(
                new TransactionTemplate(transactionManager), jdbc, em, mapping, problems, mapper));
    registration.addUrlPatterns("/api/v1/*");
    registration.setOrder(0);
    return registration;
  }
}

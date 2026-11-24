package com.taskflow.shared.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.web.filter.OncePerRequestFilter;

/** Reads {@code X-Client-Id} (a UUID; anything else is ignored) for the length of the request. */
class ClientIdFilter extends OncePerRequestFilter {

  static final String HEADER = "X-Client-Id";

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String raw = request.getHeader(HEADER);
    if (raw != null) {
      try {
        ClientIdHolder.set(UUID.fromString(raw.trim()));
      } catch (IllegalArgumentException ignored) {
        // not a client id: treated as absent
      }
    }
    try {
      chain.doFilter(request, response);
    } finally {
      ClientIdHolder.clear();
    }
  }
}

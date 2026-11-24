package com.taskflow.identity.internal;

import com.taskflow.shared.Actor;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.ProblemResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates {@code Authorization: Bearer tf_sk_...} and the raw {@code Authorization:
 * tf_sk_...} (KEY-3). Any other header, including a JWT, is left to the resource server. The key is
 * never logged or echoed.
 */
class ApiKeyAuthenticationFilter extends OncePerRequestFilter {

  private static final Logger log = LoggerFactory.getLogger(ApiKeyAuthenticationFilter.class);
  private static final String BEARER = "bearer ";

  private final ApiKeyAuthenticator authenticator;
  private final ApiKeyAdmission admission;
  private final ApiKeyUsageRecorder usage;
  private final ProblemResponseWriter problems;

  ApiKeyAuthenticationFilter(
      ApiKeyAuthenticator authenticator,
      ApiKeyAdmission admission,
      ApiKeyUsageRecorder usage,
      ProblemResponseWriter problems) {
    this.authenticator = authenticator;
    this.admission = admission;
    this.usage = usage;
    this.problems = problems;
  }

  /** The key in the header, when the header carries one in either accepted form. */
  static Optional<String> keyOf(String header) {
    if (header == null) {
      return Optional.empty();
    }
    String value = header.trim();
    if (value.regionMatches(true, 0, BEARER, 0, BEARER.length())) {
      value = value.substring(BEARER.length()).trim();
    }
    return value.startsWith(ApiKeyAuthenticator.PREFIX) ? Optional.of(value) : Optional.empty();
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    Optional<String> key = keyOf(request.getHeader("Authorization"));
    if (key.isEmpty()) {
      chain.doFilter(request, response);
      return;
    }
    Optional<ApiKeyAuthenticator.Resolved> resolved;
    try {
      resolved = authenticator.resolve(key.get());
    } catch (RuntimeException e) {
      log.error("api key lookup failed: {}", e.toString());
      problems.write(
          response,
          HttpStatus.SERVICE_UNAVAILABLE,
          "auth.unavailable",
          "Authentication is temporarily unavailable");
      return;
    }
    if (resolved.isEmpty()) {
      admission.noteFailure(request.getRemoteAddr());
      problems.write(
          response,
          HttpStatus.UNAUTHORIZED,
          "auth.invalid_api_key",
          "The API key is invalid, expired or revoked");
      return;
    }
    ApiKeyAuthenticator.Resolved r = resolved.get();
    ApiKeyAdmission.Window window;
    try {
      window = admission.hit(r.keyId());
    } catch (RuntimeException e) {
      // Fail closed: without the counter there is no limit to enforce.
      log.error("api key rate limit unavailable: {}", e.toString());
      problems.write(
          response,
          HttpStatus.SERVICE_UNAVAILABLE,
          "rate_limit.unavailable",
          "The rate limiter is temporarily unavailable");
      return;
    }
    // On the raw response, before IdempotencyFilter wraps it, so errors and replays carry them too.
    response.setHeader("X-RateLimit-Limit", String.valueOf(window.limit()));
    response.setHeader("X-RateLimit-Remaining", String.valueOf(window.remaining()));
    response.setHeader("X-RateLimit-Reset", String.valueOf(window.resetEpochSecond()));
    if (!window.allowed()) {
      response.setHeader("Retry-After", String.valueOf(window.retryAfter()));
      problems.write(
          response,
          HttpStatus.TOO_MANY_REQUESTS,
          "rate_limit.exceeded",
          "Rate limit exceeded: " + window.limit() + " calls per minute per key");
      return;
    }
    usage.record(r.workspaceId(), r.keyId());
    SecurityContext context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(
        UsernamePasswordAuthenticationToken.authenticated(
            new Actor(ActorType.SERVICE_ACCOUNT, r.serviceAccountId(), r.keyId()),
            null,
            List.of(new SimpleGrantedAuthority("ROLE_SERVICE_ACCOUNT"))));
    SecurityContextHolder.setContext(context);
    chain.doFilter(request, response);
  }
}

package com.taskflow.identity.internal;

import com.taskflow.shared.Actor;
import com.taskflow.shared.ProblemResponseWriter;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.PermissionEvaluator;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.expression.method.MethodSecurityExpressionHandler;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

/** Stateless JWT resource server (AD-4, AD-5). Roles resolve per request, not from the token. */
@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties({JwtProperties.class, ApiKeyProperties.class, SignInLimits.class})
class SecurityConfig {

  @Bean
  SecurityFilterChain securityFilterChain(
      HttpSecurity http,
      JwtService jwt,
      ProblemResponseWriter problems,
      ApiKeyAuthenticator apiKeys,
      ApiKeyAdmission admission,
      ApiKeyUsageRecorder usage)
      throws Exception {
    http.csrf(AbstractHttpConfigurer::disable)
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .authorizeHttpRequests(a ->
            a.requestMatchers(
                    HttpMethod.POST,
                    "/api/v1/auth/signup",
                    "/api/v1/auth/signin",
                    "/api/v1/auth/refresh",
                    "/api/v1/auth/signout")
                .permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/invites/*")
                .permitAll()
                .requestMatchers(
                    "/api/v1/meta",
                    "/v3/api-docs",
                    "/v3/api-docs/**",
                    "/swagger-ui/**",
                    "/swagger-ui.html",
                    "/actuator/health",
                    "/actuator/health/**")
                .permitAll()
                .requestMatchers("/api/v1/**")
                .authenticated()
                .anyRequest()
                .permitAll())
        .exceptionHandling(e ->
            e.authenticationEntryPoint((request, response, ex) ->
                    problems.write(
                        response,
                        HttpStatus.UNAUTHORIZED,
                        "auth.unauthenticated",
                        "Authentication required"))
                .accessDeniedHandler((request, response, ex) ->
                    problems.write(
                        response, HttpStatus.FORBIDDEN, "auth.forbidden", "Access denied")))
        // Not a bean on purpose: a Filter bean would also be registered with the servlet container
        // and run (and rate-limit) a second time.
        .addFilterBefore(
            new ApiKeyAuthenticationFilter(apiKeys, admission, usage, problems),
            BearerTokenAuthenticationFilter.class)
        .oauth2ResourceServer(o ->
            o.bearerTokenResolver(keyAwareBearerTokenResolver())
                .jwt(j -> j.decoder(jwt.decoder()).jwtAuthenticationConverter(actorConverter()))
                .authenticationEntryPoint((request, response, ex) ->
                    problems.write(
                        response,
                        HttpStatus.UNAUTHORIZED,
                        "auth.unauthenticated",
                        "Missing, invalid or expired access token")));
    return http.build();
  }

  /**
   * The default resolver, except that an API key is not a JWT: leave it to the key filter instead
   * of failing it in the JWT decoder.
   */
  private static BearerTokenResolver keyAwareBearerTokenResolver() {
    DefaultBearerTokenResolver delegate = new DefaultBearerTokenResolver();
    return request -> {
      String token = delegate.resolve(request);
      return token != null && token.startsWith(ApiKeyAuthenticator.PREFIX) ? null : token;
    };
  }

  /** The principal is an {@link Actor}; modules read it only through CurrentActor. */
  private static Converter<Jwt, UsernamePasswordAuthenticationToken> actorConverter() {
    return jwt ->
        UsernamePasswordAuthenticationToken.authenticated(
            Actor.user(UUID.fromString(jwt.getSubject())),
            jwt,
            List.of(new SimpleGrantedAuthority("ROLE_USER")));
  }

  /**
   * Wires the PermissionEvaluator by type, so identity has no compile dependency on workspace,
   * where the implementation lives (decision 002).
   */
  @Bean
  static MethodSecurityExpressionHandler methodSecurityExpressionHandler(
      ObjectProvider<PermissionEvaluator> evaluator, ApplicationContext context) {
    DefaultMethodSecurityExpressionHandler handler = new DefaultMethodSecurityExpressionHandler();
    handler.setApplicationContext(context);
    evaluator.ifAvailable(handler::setPermissionEvaluator);
    return handler;
  }
}

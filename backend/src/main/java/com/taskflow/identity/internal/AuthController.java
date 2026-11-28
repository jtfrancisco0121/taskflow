package com.taskflow.identity.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class AuthController {

  static final String COOKIE = "refresh_token";
  static final String COOKIE_PATH = "/api/v1/auth";

  record SignUpRequest(
      @NotBlank @Email @Size(max = 254) String email,
      @NotBlank @Size(min = 10, max = 128) String password,
      @NotBlank @Size(max = 100) String displayName) {}

  record SignInRequest(@NotBlank String email, @NotBlank String password) {}

  record UserResponse(java.util.UUID id, String email, String displayName) {
    static UserResponse of(UserInfo u) {
      return new UserResponse(u.id(), u.email(), u.displayName());
    }
  }

  record AuthResponse(String accessToken, String tokenType, long expiresIn, UserResponse user) {}

  private final AuthService auth;
  private final JwtProperties properties;
  private final UserDirectory users;

  AuthController(AuthService auth, JwtProperties properties, UserDirectory users) {
    this.auth = auth;
    this.properties = properties;
    this.users = users;
  }

  @PostMapping("/auth/signup")
  ResponseEntity<AuthResponse> signUp(@Valid @RequestBody SignUpRequest request) {
    return respond(
        HttpStatus.CREATED,
        auth.signUp(request.email(), request.password(), request.displayName()));
  }

  @PostMapping("/auth/signin")
  ResponseEntity<AuthResponse> signIn(
      @Valid @RequestBody SignInRequest request, HttpServletRequest http) {
    return respond(
        HttpStatus.OK, auth.signIn(request.email(), request.password(), http.getRemoteAddr()));
  }

  @PostMapping("/auth/refresh")
  ResponseEntity<AuthResponse> refresh(
      @CookieValue(name = COOKIE, required = false) String refreshToken) {
    return respond(HttpStatus.OK, auth.refresh(refreshToken));
  }

  /**
   * The clearing cookie is set on the servlet response in a finally, so it survives into the error
   * response when revoking the family fails: the browser drops the token either way.
   */
  @PostMapping("/auth/signout")
  ResponseEntity<Void> signOut(
      @CookieValue(name = COOKIE, required = false) String refreshToken,
      HttpServletResponse response) {
    try {
      auth.signOut(refreshToken);
    } finally {
      response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO).toString());
    }
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/me")
  UserResponse me() {
    return users
        .byId(CurrentActor.userId())
        .map(UserResponse::of)
        .orElseThrow(() -> TaskflowException.notFound("user.not_found", "User not found"));
  }

  private ResponseEntity<AuthResponse> respond(HttpStatus status, AuthService.Session session) {
    return ResponseEntity.status(status)
        .header(
            HttpHeaders.SET_COOKIE,
            cookie(session.refreshToken(), properties.refreshTtl()).toString())
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .body(
            new AuthResponse(
                session.accessToken(),
                "Bearer",
                session.expiresIn(),
                UserResponse.of(session.user())));
  }

  private static ResponseCookie cookie(String value, Duration maxAge) {
    return ResponseCookie.from(COOKIE, value)
        .httpOnly(true)
        .secure(true)
        .sameSite("Strict")
        .path(COOKIE_PATH)
        .maxAge(maxAge)
        .build();
  }
}

package com.taskflow.identity.internal;

import com.taskflow.identity.UserInfo;
import com.taskflow.shared.Ids;
import com.taskflow.shared.LockContention;
import com.taskflow.shared.RateLimiter;
import com.taskflow.shared.TaskflowException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Sign-up, sign-in, rotating refresh tokens and sign-out (AUTH-1, AUTH-2). */
@Service
class AuthService {

  static final int EMAIL_FAILURE_LIMIT = 5;
  static final Duration EMAIL_WINDOW = Duration.ofMinutes(15);
  static final int IP_ATTEMPT_LIMIT = 20;
  static final Duration IP_WINDOW = Duration.ofMinutes(1);

  /**
   * How long a refresh or sign-out waits for its family lock before giving up with 503 (mapped by
   * ProblemDetailsHandler from 55P03), so a busy family cannot hold pool connections indefinitely.
   */
  static final String LOCK_TIMEOUT = "SET LOCAL lock_timeout = '2s'";

  /** Locked revoke attempts a sign-out makes before giving up (about 6 s in all). */
  static final int SIGN_OUT_ATTEMPTS = 3;

  /** An issued session: the access token plus the raw refresh token for the cookie. */
  record Session(UserInfo user, String accessToken, long expiresIn, String refreshToken) {}

  private record StoredRefresh(
      UUID id,
      UUID userId,
      UUID familyId,
      boolean expired,
      boolean revoked,
      boolean rotated,
      boolean inGrace) {}

  private static final Logger log = LoggerFactory.getLogger(AuthService.class);

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final JwtService jwt;
  private final JwtProperties properties;
  private final RateLimiter limiter;
  private final RefreshSuccessor successors;
  private final PasswordEncoder encoder = new BCryptPasswordEncoder();
  private final SecureRandom random = new SecureRandom();
  private final String dummyHash = encoder.encode("not-a-real-password");

  AuthService(
      JdbcTemplate jdbc,
      PlatformTransactionManager transactionManager,
      JwtService jwt,
      JwtProperties properties,
      RateLimiter limiter,
      RefreshSuccessor successors) {
    this.jdbc = jdbc;
    this.tx = new TransactionTemplate(transactionManager);
    this.jwt = jwt;
    this.properties = properties;
    this.limiter = limiter;
    this.successors = successors;
  }

  Session signUp(String email, String password, String displayName) {
    String normalized = normalize(email);
    UUID id = Ids.newId();
    try {
      return tx.execute(status -> {
        jdbc.update(
            "INSERT INTO app_user (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
            id,
            normalized,
            encoder.encode(password),
            displayName.trim());
        return startSession(new UserInfo(id, normalized, displayName.trim()), UUID.randomUUID());
      });
    } catch (DuplicateKeyException e) {
      throw TaskflowException.conflict("auth.email_taken", "That email is already registered");
    }
  }

  Session signIn(String email, String password, String ip) {
    String normalized = normalize(email);
    String emailKey = "signin:email:" + normalized;
    RateLimiter.Decision byIp = limiter.hit("signin:ip:" + ip, IP_ATTEMPT_LIMIT, IP_WINDOW);
    if (!byIp.allowed()) {
      throw rateLimited(byIp.retryAfterSeconds());
    }
    RateLimiter.Decision byEmail = limiter.peek(emailKey, EMAIL_FAILURE_LIMIT, EMAIL_WINDOW);
    if (!byEmail.allowed()) {
      throw rateLimited(byEmail.retryAfterSeconds());
    }
    Optional<UserRow> user =
        jdbc
            .query(
                "SELECT id, email, display_name, password_hash FROM app_user WHERE lower(email) = ?"
                    + " AND kind = 'HUMAN'",
                (rs, i) ->
                    new UserRow(
                        new UserInfo(
                            rs.getObject("id", UUID.class),
                            rs.getString("email"),
                            rs.getString("display_name")),
                        rs.getString("password_hash")),
                normalized)
            .stream()
            .findFirst();
    boolean ok =
        encoder.matches(password, user.map(UserRow::hash).orElse(dummyHash)) && user.isPresent();
    if (!ok) {
      limiter.hit(emailKey, EMAIL_FAILURE_LIMIT, EMAIL_WINDOW);
      throw new TaskflowException(
          HttpStatus.UNAUTHORIZED, "auth.invalid_credentials", "Wrong email or password");
    }
    limiter.reset(emailKey);
    return tx.execute(status -> startSession(user.get().info(), UUID.randomUUID()));
  }

  /**
   * Rotates the refresh token; presenting a rotated one revokes its family, except the token
   * rotated less than {@code refreshReuseGrace} ago whose successor is still unused: that replay
   * gets the same successor back (decision 010: a reload that lost the rotation response, or two
   * tabs).
   */
  Session refresh(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      throw invalidRefresh();
    }
    String hash = sha256(rawToken);
    enum Outcome {
      OK,
      REUSED,
      INVALID
    }
    record Result(Outcome outcome, Session session) {}
    long graceMillis = properties.refreshReuseGrace().toMillis();
    Result result =
        tx.execute(status -> {
          jdbc.execute(LOCK_TIMEOUT);
          if (!lockLiveFamilyOf(hash)) {
            return new Result(Outcome.INVALID, null);
          }
          // The family lock already orders every request on this family; FOR UPDATE stays as a
          // second guard on the row itself.
          List<StoredRefresh> found =
              jdbc.query(
                  "SELECT id, user_id, family_id, expires_at < now() AS expired, revoked_at IS NOT"
                      + " NULL AS revoked,"
                      + " rotated_at IS NOT NULL AS rotated, rotated_at > now() - (? * interval '1"
                      + " millisecond') AS in_grace FROM refresh_token WHERE token_hash = ? FOR"
                      + " UPDATE",
                  (rs, i) ->
                      new StoredRefresh(
                          rs.getObject("id", UUID.class),
                          rs.getObject("user_id", UUID.class),
                          rs.getObject("family_id", UUID.class),
                          rs.getBoolean("expired"),
                          rs.getBoolean("revoked"),
                          rs.getBoolean("rotated"),
                          rs.getBoolean("in_grace")),
                  graceMillis,
                  hash);
          if (found.isEmpty()) {
            return new Result(Outcome.INVALID, null);
          }
          StoredRefresh stored = found.get(0);
          // Expiry is judged on the database clock, like the grace window (decision 010).
          boolean live = !stored.revoked() && !stored.expired();
          String successor = successors.of(rawToken);
          if (live && !stored.rotated()) {
            // The user is checked first, so a refused token is never left rotated with no
            // successor.
            Optional<UserInfo> user = humanUser(stored.userId());
            if (user.isEmpty()) {
              return new Result(Outcome.INVALID, null);
            }
            jdbc.update("UPDATE refresh_token SET rotated_at = now() WHERE id = ?", stored.id());
            insertRefresh(user.get().id(), stored.familyId(), successor);
            return new Result(Outcome.OK, session(user.get(), successor));
          }
          if (live && graceMillis > 0 && stored.inGrace() && isUnusedLive(stored, successor)) {
            Optional<UserInfo> user = humanUser(stored.userId());
            if (user.isEmpty()) {
              return new Result(Outcome.INVALID, null);
            }
            log.info(
                "Refresh token replayed within the grace window; family {}", stored.familyId());
            return new Result(Outcome.OK, session(user.get(), successor));
          }
          revokeFamily(stored.familyId());
          return new Result(Outcome.REUSED, null);
        });
    if (result.outcome() == Outcome.OK) {
      return result.session();
    }
    throw invalidRefresh();
  }

  /** True when the family's only live token is {@code successor}, still unrotated and unexpired. */
  private boolean isUnusedLive(StoredRefresh stored, String successor) {
    List<String> live =
        jdbc.queryForList(
            "SELECT token_hash FROM refresh_token WHERE family_id = ? AND rotated_at IS NULL AND"
                + " revoked_at IS NULL AND expires_at > now() FOR UPDATE",
            String.class,
            stored.familyId());
    return live.size() == 1 && RefreshSuccessor.sameHash(sha256(successor), live.get(0));
  }

  private Optional<UserInfo> humanUser(UUID id) {
    return jdbc
        .query(
            "SELECT id, email, display_name FROM app_user WHERE id = ? AND kind = 'HUMAN'",
            (rs, i) ->
                new UserInfo(
                    rs.getObject("id", UUID.class),
                    rs.getString("email"),
                    rs.getString("display_name")),
            id)
        .stream()
        .findFirst();
  }

  /**
   * Revokes the token's family. A token that can never be honoured again (revoked, or expired and
   * never rotated) has nothing live in its family, so it returns without the family lock. Otherwise
   * the locked revoke is tried {@link #SIGN_OUT_ATTEMPTS} times on lock contention ({@link
   * LockContention}), each a fresh transaction with its own lock timeout, because the controller
   * clears the cookie whatever happens and the browser cannot retry: giving up leaves the family
   * live until it expires (decision 010, Hardening).
   */
  void signOut(String rawToken) {
    if (rawToken == null || rawToken.isBlank()) {
      return;
    }
    Optional<UUID> family = liveFamilyOf(sha256(rawToken));
    if (family.isEmpty()) {
      return;
    }
    for (int attempt = 1; ; attempt++) {
      try {
        tx.executeWithoutResult(status -> {
          jdbc.execute(LOCK_TIMEOUT);
          lockFamily(family.get());
          revokeFamily(family.get());
        });
        return;
      } catch (RuntimeException e) {
        boolean contention = LockContention.isContention(e);
        if (contention && attempt < SIGN_OUT_ATTEMPTS) {
          continue;
        }
        // Whatever the cause, the controller still clears the cookie and the family stays live
        // until it expires (decision 010), so name the family for an operator. Never the token.
        log.error(
            "Sign-out could not revoke family {} (attempt {} of {}, {}); it stays live until it"
                + " expires",
            family.get(),
            attempt,
            SIGN_OUT_ATTEMPTS,
            e.getClass().getSimpleName(),
            e);
        if (!contention) {
          throw e;
        }
        throw new TaskflowException(
            HttpStatus.SERVICE_UNAVAILABLE,
            "request.busy",
            "Signed out on this device, but the session could not be ended everywhere");
      }
    }
  }

  /**
   * Takes the family lock of the token with {@code hash}; false, without locking, when no such
   * token exists or it can never be honoured again. Every refresh and sign-out takes this lock
   * first, before any refresh_token row lock, so requests on one family run one after another: no
   * lock-order deadlock between the token row and the family-wide statements, and a sign-out never
   * misses a successor inserted by a concurrent rotation. family_id never changes, so reading it
   * without a lock is safe.
   *
   * <p>A revoked token, or an expired one that was never rotated, is refused before the lock
   * (ClickUp 14yq6g334r6), so flooding with it cannot queue requests on the family. Both states are
   * final, so the unlocked read cannot let a token through: a token read as live here is read again
   * under the lock. Revocation is always family-wide, so there is nothing left to revoke; an
   * expired, never-rotated token is its family's newest, so nothing after it can be live. An
   * expired token that was rotated still takes the lock and revokes its family as reuse.
   */
  private boolean lockLiveFamilyOf(String hash) {
    Optional<UUID> family = liveFamilyOf(hash);
    family.ifPresent(this::lockFamily);
    return family.isPresent();
  }

  /** The token's family, unless the token is revoked or expired and never rotated. */
  private Optional<UUID> liveFamilyOf(String hash) {
    return jdbc
        .queryForList(
            "SELECT family_id FROM refresh_token WHERE token_hash = ? AND revoked_at IS NULL"
                + " AND NOT (rotated_at IS NULL AND expires_at < now())",
            UUID.class,
            hash)
        .stream()
        .findFirst();
  }

  /** Transaction-scoped advisory lock per family, keyed like AutomationAuthorsImpl's lock. */
  private void lockFamily(UUID familyId) {
    jdbc.query(
        "SELECT pg_advisory_xact_lock(hashtextextended(?, 0))",
        rs -> {},
        "refresh_family:" + familyId);
  }

  private record UserRow(UserInfo info, String hash) {}

  private void revokeFamily(UUID familyId) {
    jdbc.update(
        "UPDATE refresh_token SET revoked_at = now() WHERE family_id = ? AND revoked_at IS NULL",
        familyId);
  }

  private Session startSession(UserInfo user, UUID familyId) {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    insertRefresh(user.id(), familyId, raw);
    return session(user, raw);
  }

  private void insertRefresh(UUID userId, UUID familyId, String raw) {
    // Expiry from the database clock, the one that later judges it.
    jdbc.update(
        "INSERT INTO refresh_token (id, user_id, family_id, token_hash, expires_at) VALUES (?, ?,"
            + " ?, ?, now() + (? * interval '1 millisecond'))",
        Ids.newId(),
        userId,
        familyId,
        sha256(raw),
        properties.refreshTtl().toMillis());
  }

  private Session session(UserInfo user, String rawRefresh) {
    return new Session(
        user, jwt.issue(user.id(), user.email()), jwt.expiresInSeconds(), rawRefresh);
  }

  private static TaskflowException invalidRefresh() {
    return new TaskflowException(
        HttpStatus.UNAUTHORIZED, "auth.invalid_refresh", "The refresh token is invalid or expired");
  }

  private static TaskflowException rateLimited(long retryAfter) {
    return new TaskflowException(
            HttpStatus.TOO_MANY_REQUESTS, "auth.rate_limited", "Too many sign-in attempts")
        .header("Retry-After", String.valueOf(retryAfter));
  }

  private static String normalize(String email) {
    return email.trim().toLowerCase(java.util.Locale.ROOT);
  }

  static String sha256(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}

package com.taskflow.identity.internal;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

/** Issues and decodes HS256 access tokens with claims {@code sub} and {@code email} (AD-5). */
@Component
class JwtService {

  private final JwtProperties properties;
  private final JwtEncoder encoder;
  private final JwtDecoder decoder;
  private final Clock clock = Clock.systemUTC();

  /** Test seam: builds its own decoder like {@link #decoder(JwtProperties)}. */
  JwtService(JwtProperties properties) {
    this(properties, decoder(properties));
  }

  @Autowired
  JwtService(JwtProperties properties, JwtDecoder decoder) {
    this.properties = properties;
    this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key(properties)));
    this.decoder = decoder;
  }

  private static SecretKey key(JwtProperties properties) {
    return new SecretKeySpec(properties.secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
  }

  /** The one HS256 decoder; {@link JwtConfig} publishes it as a bean for the STOMP gateway. */
  static JwtDecoder decoder(JwtProperties properties) {
    return NimbusJwtDecoder.withSecretKey(key(properties)).macAlgorithm(MacAlgorithm.HS256).build();
  }

  String issue(UUID userId, String email) {
    Instant now = clock.instant();
    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .subject(userId.toString())
            .claim("email", email)
            .issuedAt(now)
            .expiresAt(now.plus(properties.accessTtl()))
            .build();
    return encoder
        .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
        .getTokenValue();
  }

  long expiresInSeconds() {
    return properties.accessTtl().toSeconds();
  }

  JwtDecoder decoder() {
    return decoder;
  }
}

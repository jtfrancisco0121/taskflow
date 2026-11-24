package com.taskflow.shared.internal;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.apache.catalina.valves.RemoteIpValve;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Which proxies may set the client IP through {@code X-Forwarded-For} (decision 006). {@code
 * server.forward-headers-strategy: native} installs Tomcat's {@link RemoteIpValve}; this limits the
 * proxies it trusts to the exact addresses in {@code taskflow.http.trusted-proxies}, by default
 * none. The valve reads the header right to left and stops at the first address that is not a
 * trusted proxy, so a value a client prepends never becomes its IP.
 */
@Configuration(proxyBeanMethods = false)
class TrustedProxyConfig {

  private static final Pattern IP_LITERAL = Pattern.compile("[0-9.]+|[0-9a-fA-F:]+");

  @Bean
  WebServerFactoryCustomizer<TomcatServletWebServerFactory> trustedProxies(
      @Value("${taskflow.http.trusted-proxies:}") List<String> proxies) {
    String internalProxies = internalProxies(proxies);
    return factory -> {
      List<RemoteIpValve> valves =
          factory.getEngineValves().stream()
              .filter(RemoteIpValve.class::isInstance)
              .map(RemoteIpValve.class::cast)
              .toList();
      if (valves.isEmpty() && !internalProxies.isEmpty()) {
        throw new IllegalStateException(
            "taskflow.http.trusted-proxies needs server.forward-headers-strategy: native");
      }
      valves.forEach(valve -> {
        valve.setInternalProxies(internalProxies);
        valve.setTrustedProxies(null);
      });
    };
  }

  /** An exact-match regex for the listed IP literals; empty when none are listed. */
  static String internalProxies(List<String> proxies) {
    return proxies.stream()
        .map(String::trim)
        .filter(p -> !p.isEmpty())
        .map(TrustedProxyConfig::normalize)
        .distinct()
        .map(Pattern::quote)
        .collect(Collectors.joining("|"));
  }

  /** The address as Tomcat reports a remote address, for example ::1 as 0:0:0:0:0:0:0:1. */
  private static String normalize(String ip) {
    if (!IP_LITERAL.matcher(ip).matches()) {
      throw new IllegalArgumentException("trusted proxy is not an IP address: " + ip);
    }
    try {
      return InetAddress.getByName(ip).getHostAddress();
    } catch (UnknownHostException e) {
      throw new IllegalArgumentException("trusted proxy is not an IP address: " + ip, e);
    }
  }
}

package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

@DisplayName("RT-3 client id holder")
class ClientIdHolderTest {

  private AtomicReference<Object> seenInside(String header) throws Exception {
    AtomicReference<Object> seen = new AtomicReference<>();
    MockHttpServletRequest request = new MockHttpServletRequest();
    if (header != null) {
      request.addHeader("X-Client-Id", header);
    }
    FilterChain chain = (req, res) -> seen.set(ClientIdHolder.current().orElse(null));
    new ClientIdFilter().doFilter(request, new MockHttpServletResponse(), chain);
    return seen;
  }

  @Test
  void isEmptyOutsideARequest() {
    assertThat(ClientIdHolder.current()).isEmpty();
  }

  @Test
  void isSetForTheRequestAndClearedAfterwards() throws Exception {
    UUID id = UUID.randomUUID();
    assertThat(seenInside(id.toString()).get()).isEqualTo(id);
    assertThat(ClientIdHolder.current()).isEmpty();
  }

  @Test
  void aMissingOrMalformedHeaderIsIgnored() throws Exception {
    assertThat(seenInside(null).get()).isNull();
    assertThat(seenInside("not-a-uuid").get()).isNull();
    assertThat(ClientIdHolder.current()).isEmpty();
  }

  @Test
  void isClearedEvenWhenTheRequestFails() {
    try {
      new ClientIdFilter()
          .doFilter(
              requestWith(UUID.randomUUID().toString()),
              new MockHttpServletResponse(),
              (req, res) -> {
                throw new IllegalStateException("boom");
              });
    } catch (Exception expected) {
      // the filter rethrows
    }
    assertThat(ClientIdHolder.current()).isEmpty();
  }

  private static MockHttpServletRequest requestWith(String header) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("X-Client-Id", header);
    return request;
  }
}

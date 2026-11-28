package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

import java.io.DataInputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.ContainerLaunchException;
import org.testcontainers.containers.wait.strategy.WaitStrategy;
import org.testcontainers.containers.wait.strategy.WaitStrategyTarget;

/**
 * ClickUp 14yq6g334t6: a port that accepts TCP and then closes (what the 08P01 failure looked like
 * from pgjdbc) is not a started database. The wait keeps trying until a JDBC connection really
 * works, and gives up with the cause once its startup timeout passes.
 */
@DisplayName("Testcontainers Postgres connection wait")
class PostgresConnectionWaitTest {

  /** Protocol code of a Postgres SSLRequest; a StartupMessage carries 196608 (3.0) instead. */
  private static final int SSL_REQUEST = 80877103;

  private ServerSocket server;
  private Thread acceptor;
  private final AtomicInteger accepted = new AtomicInteger();
  private final ConcurrentLinkedQueue<Integer> firstCodes = new ConcurrentLinkedQueue<>();

  /** Accepts every connection, reads the client's first message, then closes without answering. */
  private int closingServer() throws Exception {
    return server(false);
  }

  /** Accepts every connection, reads the client's first message, then never answers nor closes. */
  private int silentServer() throws Exception {
    return server(true);
  }

  private final java.util.List<Socket> held = new java.util.concurrent.CopyOnWriteArrayList<>();

  private int server(boolean silent) throws Exception {
    server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    acceptor =
        new Thread(() -> {
          while (!server.isClosed()) {
            try {
              Socket s = server.accept();
              held.add(s);
              accepted.incrementAndGet();
              s.setSoTimeout(2000);
              DataInputStream in = new DataInputStream(s.getInputStream());
              in.readInt(); // length
              firstCodes.add(in.readInt());
              if (!silent) s.close();
            } catch (Exception e) {
              // closed by the test, or the client gave up: keep accepting
            }
          }
        });
    acceptor.setDaemon(true);
    acceptor.start();
    return server.getLocalPort();
  }

  @AfterEach
  void stop() throws Exception {
    if (server != null) server.close();
    for (Socket s : held) s.close();
    if (acceptor != null) acceptor.join(2000);
  }

  private static final WaitStrategy LOG_READY =
      new WaitStrategy() {
        @Override
        public void waitUntilReady(WaitStrategyTarget target) {}

        @Override
        public WaitStrategy withStartupTimeout(Duration startupTimeout) {
          return this;
        }
      };

  /** The URL the container's own getJdbcUrl() would build, pointed at the fake server. */
  private PostgresConnectionWait waitFor(int port) {
    String url =
        "jdbc:postgresql://127.0.0.1:"
            + port
            + "/test"
            + new TaskflowPostgresContainer("postgres:18").urlQuery();
    return (PostgresConnectionWait)
        new PostgresConnectionWait(LOG_READY, () -> url, () -> "test", () -> "test")
            .withStartupTimeout(Duration.ofSeconds(2));
  }

  @Test
  void aPortThatAcceptsAndClosesIsNotStarted() throws Exception {
    int port = closingServer();
    long start = System.nanoTime();

    assertThatThrownBy(() -> waitFor(port).waitUntilReady((WaitStrategyTarget) null))
        .isInstanceOf(ContainerLaunchException.class)
        .hasMessageContaining("JDBC connection")
        .hasCauseInstanceOf(java.sql.SQLException.class);

    assertThat(Duration.ofNanos(System.nanoTime() - start)).isGreaterThan(Duration.ofSeconds(1));
    assertThat(accepted.get()).as("it retried, not one attempt").isGreaterThan(1);
  }

  @Test
  void aPortThatAcceptsAndNeverAnswersStillEndsAtTheDeadline() throws Exception {
    int port = silentServer();
    long start = System.nanoTime();

    assertTimeoutPreemptively(
        Duration.ofSeconds(20),
        () ->
            assertThatThrownBy(() -> waitFor(port).waitUntilReady((WaitStrategyTarget) null))
                .isInstanceOf(ContainerLaunchException.class)
                .hasCauseInstanceOf(java.sql.SQLException.class));

    assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(10));
  }

  @Test
  void aSlowLogWaitStillLeavesTheJdbcPhaseAnAttempt() throws Exception {
    int port = closingServer();
    WaitStrategy slowLog =
        new WaitStrategy() {
          @Override
          public void waitUntilReady(WaitStrategyTarget target) {
            try {
              Thread.sleep(2100); // longer than the 2 s startup timeout
            } catch (InterruptedException e) {
              Thread.currentThread().interrupt();
            }
          }

          @Override
          public WaitStrategy withStartupTimeout(Duration startupTimeout) {
            return this;
          }
        };
    String url = "jdbc:postgresql://127.0.0.1:" + port + "/test?sslmode=disable";
    WaitStrategy wait =
        new PostgresConnectionWait(slowLog, () -> url, () -> "test", () -> "test")
            .withStartupTimeout(Duration.ofSeconds(2));

    assertThatThrownBy(() -> wait.waitUntilReady((WaitStrategyTarget) null))
        .isInstanceOf(ContainerLaunchException.class)
        .hasCauseInstanceOf(java.sql.SQLException.class);
    assertThat(accepted.get()).isGreaterThanOrEqualTo(1);
  }

  @Test
  void theContainersUrlStartsWithoutTlsNegotiation() throws Exception {
    int port = closingServer();

    assertThatThrownBy(() -> waitFor(port).waitUntilReady((WaitStrategyTarget) null))
        .isInstanceOf(ContainerLaunchException.class);

    assertThat(firstCodes).isNotEmpty().doesNotContain(SSL_REQUEST);
  }
}

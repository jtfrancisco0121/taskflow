package com.taskflowfixture.a;

import com.taskflowfixture.b.internal.Secret;

/** Violates the boundary: reaches into b.internal. */
public class UsesSecret {
  Secret secret = new Secret();
}

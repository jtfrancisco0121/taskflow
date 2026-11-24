package com.taskflow.shared;

import java.util.List;

/** Keyset page envelope (AD-17). */
public record Page<T>(List<T> items, String nextCursor) {}

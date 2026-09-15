package com.example;

import lombok.Data;

@Data
public class Widget {
    private String name;

    // Explicit override — Lombok must not synthesize a second getName().
    public String getName() {
        return name.toUpperCase();
    }
}

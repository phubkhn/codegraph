package com.example.basic;

public class B {
    private final C c;

    public B(C c) {
        this.c = c;
    }

    public void bar() {
        c.baz();
    }
}

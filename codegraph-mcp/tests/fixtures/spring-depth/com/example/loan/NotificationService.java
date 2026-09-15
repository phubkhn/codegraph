package com.example.loan;

import org.springframework.stereotype.Service;

@Service
public class NotificationService {
    public void notify(Long id) {
        System.out.println("notify " + id);
    }
}

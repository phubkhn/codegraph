package com.example.loan;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class AccountingListener {

    @KafkaListener(topics = "loan.disbursed")
    public void onLoanDisbursed(String payload) {
        System.out.println(payload);
    }
}

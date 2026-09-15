package com.example.loan;

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class DisbursementService {
    private final KafkaTemplate<String, String> kafkaTemplate;

    public DisbursementService(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void execute(Long id) {
        kafkaTemplate.send("loan.disbursed", id.toString());
    }
}

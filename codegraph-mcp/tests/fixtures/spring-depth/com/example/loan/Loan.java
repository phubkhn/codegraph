package com.example.loan;

import java.util.List;
import javax.persistence.Entity;
import javax.persistence.ManyToOne;
import javax.persistence.OneToMany;

@Entity
public class Loan {
    @ManyToOne
    private Customer customer;

    @OneToMany
    private List<Payment> payments;
}

package com.example.loan;

public interface LoanRepository {
    void save(Long id);

    void findById(Long id);
}

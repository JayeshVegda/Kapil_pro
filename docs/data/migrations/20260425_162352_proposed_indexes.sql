-- Proposed migration (not auto-applied)
CREATE UNIQUE INDEX idx_bills_book_bill ON bills(book_no, bill_no);
CREATE INDEX idx_bills_date ON bills(date);
CREATE INDEX idx_payments_date ON payments(date);
CREATE INDEX idx_bill_items_item_name ON bill_items(item_name);
CREATE INDEX idx_misc_expenses_type_date ON misc_expenses(type, date);

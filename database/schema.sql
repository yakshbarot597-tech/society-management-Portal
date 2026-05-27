-- =========================================================
-- TRIGGER FUNCTION FOR UPDATING TIMESTAMP
-- =========================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =========================================================
-- SOCIETIES
-- =========================================================

CREATE TABLE societies (
    id BIGSERIAL PRIMARY KEY,

    society_name VARCHAR(255) NOT NULL,

    property_type VARCHAR(50) DEFAULT 'flat' CHECK (property_type IN ('flat', 'villa', 'shop', 'mixed')),

    total_blocks INT DEFAULT 0,
    total_units INT DEFAULT 0,

    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),

    default_due_day SMALLINT DEFAULT 1,
    grace_days SMALLINT DEFAULT 5,
    late_fee_percent DECIMAL(5,2) DEFAULT 0.00,

    is_active SMALLINT DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_society_name UNIQUE (society_name)
);

CREATE TRIGGER update_societies_updated_at BEFORE UPDATE ON societies
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- USERS
-- =========================================================

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,

    username VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(15),

    password_hash VARCHAR(255) NOT NULL,

    full_name VARCHAR(255) NOT NULL,

    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'admin', 'committee', 'resident', 'staff')),

    is_active SMALLINT DEFAULT 1,

    last_login_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT uq_username UNIQUE (username),
    CONSTRAINT uq_email UNIQUE (email)
);

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- BLOCKS
-- =========================================================

CREATE TABLE blocks (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,

    block_name VARCHAR(20) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_blocks_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT uq_block UNIQUE (
        society_id,
        block_name
    )
);

-- =========================================================
-- UNITS / FLATS
-- =========================================================

CREATE TABLE units (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,
    block_id BIGINT NULL,

    unit_number VARCHAR(20) NOT NULL,

    floor_number VARCHAR(10),

    unit_type VARCHAR(50) DEFAULT 'flat' CHECK (unit_type IN ('flat', 'villa', 'shop', 'office')),

    area_sqft DECIMAL(10,2),

    occupancy_status VARCHAR(50) DEFAULT 'occupied' CHECK (occupancy_status IN ('occupied', 'vacant', 'maintenance')),

    is_active SMALLINT DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_units_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_units_block
        FOREIGN KEY (block_id)
        REFERENCES blocks(id)
        ON DELETE SET NULL,

    CONSTRAINT uq_unit UNIQUE (
        society_id,
        unit_number
    )
);

CREATE TRIGGER update_units_updated_at BEFORE UPDATE ON units
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- UNIT RESIDENTS
-- =========================================================

CREATE TABLE unit_residents (
    id BIGSERIAL PRIMARY KEY,

    unit_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,

    resident_type VARCHAR(50) NOT NULL CHECK (resident_type IN ('owner', 'tenant', 'family_member')),

    is_primary SMALLINT DEFAULT 0,

    move_in_date DATE,
    move_out_date DATE NULL,

    is_active SMALLINT DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_unit_resident_unit
        FOREIGN KEY (unit_id)
        REFERENCES units(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_unit_resident_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT uq_unit_resident UNIQUE (
        unit_id,
        user_id
    )
);

-- =========================================================
-- MAINTENANCE INVOICES
-- =========================================================

CREATE TABLE maintenance_invoices (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,
    unit_id BIGINT NOT NULL,

    invoice_number VARCHAR(50) NOT NULL,

    billing_year INT NOT NULL,
    billing_month SMALLINT NOT NULL,

    amount DECIMAL(12,2) NOT NULL,
    late_fee DECIMAL(12,2) DEFAULT 0.00,

    total_amount DECIMAL(12,2)
        GENERATED ALWAYS AS (
            amount + late_fee
        ) STORED,

    due_date DATE NOT NULL,

    status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Paid', 'Partial', 'Overdue', 'Cancelled')),

    notes TEXT,

    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_invoice_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_invoice_unit
        FOREIGN KEY (unit_id)
        REFERENCES units(id)
        ON DELETE CASCADE,

    CONSTRAINT uq_invoice UNIQUE (
        unit_id,
        billing_year,
        billing_month
    ),

    CONSTRAINT uq_invoice_number UNIQUE (
        invoice_number
    )
);

CREATE TRIGGER update_maintenance_invoices_updated_at BEFORE UPDATE ON maintenance_invoices
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- PAYMENT TRANSACTIONS
-- =========================================================

CREATE TABLE payment_transactions (
    id BIGSERIAL PRIMARY KEY,

    invoice_id BIGINT NOT NULL,

    transaction_number VARCHAR(100),

    payment_gateway VARCHAR(50),

    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque')),

    amount DECIMAL(12,2) NOT NULL,

    gateway_response TEXT,

    status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Success', 'Failed', 'Refunded')),

    paid_at TIMESTAMP NULL,

    receipt_number VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payment_invoice
        FOREIGN KEY (invoice_id)
        REFERENCES maintenance_invoices(id)
        ON DELETE CASCADE
);

-- =========================================================
-- EXPENSES
-- =========================================================

CREATE TABLE expenses (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,

    title VARCHAR(255) NOT NULL,

    amount DECIMAL(12,2) NOT NULL,

    expense_date DATE NOT NULL,

    vendor_name VARCHAR(255),

    payment_method VARCHAR(50) CHECK (payment_method IN ('cash', 'upi', 'bank_transfer', 'card', 'cheque')),

    notes TEXT,

    attachment_url VARCHAR(500),

    created_by BIGINT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_expense_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_expense_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- NOTICES
-- =========================================================

CREATE TABLE notices (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,

    title VARCHAR(255) NOT NULL,

    details TEXT NOT NULL,

    notice_type VARCHAR(50) DEFAULT 'general' CHECK (notice_type IN ('general', 'maintenance', 'emergency', 'event')),

    publish_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    expiry_date TIMESTAMP NULL,

    attachment_url VARCHAR(500),

    created_by BIGINT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notice_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notice_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE TRIGGER update_notices_updated_at BEFORE UPDATE ON notices
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- COMPLAINTS
-- =========================================================

CREATE TABLE complaints (
    id BIGSERIAL PRIMARY KEY,

    society_id BIGINT NOT NULL,

    unit_id BIGINT NULL,

    created_by BIGINT NOT NULL,

    assigned_to BIGINT NULL,

    title VARCHAR(255) NOT NULL,

    details TEXT NOT NULL,

    priority VARCHAR(50) DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),

    status VARCHAR(50) DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),

    resolution_notes TEXT,

    resolved_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_complaint_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_complaint_unit
        FOREIGN KEY (unit_id)
        REFERENCES units(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_complaint_creator
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_complaint_assigned
        FOREIGN KEY (assigned_to)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE TRIGGER update_complaints_updated_at BEFORE UPDATE ON complaints
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_society_city ON societies (city);
CREATE INDEX idx_society_active ON societies (is_active);
CREATE INDEX idx_user_society ON users (society_id);
CREATE INDEX idx_user_role ON users (role);
CREATE INDEX idx_unit_block ON units (block_id);
CREATE INDEX idx_unit_status ON units (occupancy_status);
CREATE INDEX idx_invoice_status ON maintenance_invoices (status);
CREATE INDEX idx_invoice_due_date ON maintenance_invoices (due_date);
CREATE INDEX idx_payment_invoice ON payment_transactions (invoice_id);
CREATE INDEX idx_payment_status ON payment_transactions (status);
CREATE INDEX idx_expense_date ON expenses (expense_date);
CREATE INDEX idx_complaint_status ON complaints (status);
CREATE INDEX idx_complaint_priority ON complaints (priority);

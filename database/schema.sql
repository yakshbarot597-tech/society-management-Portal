CREATE DATABASE IF NOT EXISTS society_management
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE society_management;

-- =========================================================
-- SOCIETIES
-- =========================================================

CREATE TABLE societies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_name VARCHAR(255) NOT NULL,

    property_type ENUM(
        'flat',
        'villa',
        'shop',
        'mixed'
    ) DEFAULT 'flat',

    total_blocks INT DEFAULT 0,
    total_units INT DEFAULT 0,

    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),

    default_due_day TINYINT DEFAULT 1,
    grace_days TINYINT DEFAULT 5,
    late_fee_percent DECIMAL(5,2) DEFAULT 0.00,

    is_active TINYINT(1) DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_society_name (society_name),

    INDEX idx_society_city (city),
    INDEX idx_society_active (is_active)

) ENGINE=InnoDB;

-- =========================================================
-- USERS
-- =========================================================

CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,

    username VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(15),

    password_hash VARCHAR(255) NOT NULL,

    full_name VARCHAR(255) NOT NULL,

    role ENUM(
        'super_admin',
        'admin',
        'committee',
        'resident',
        'staff'
    ) NOT NULL,

    is_active TINYINT(1) DEFAULT 1,

    last_login_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    UNIQUE KEY uq_username (username),
    UNIQUE KEY uq_email (email),

    INDEX idx_user_society (society_id),
    INDEX idx_user_role (role)

) ENGINE=InnoDB;

-- =========================================================
-- BLOCKS
-- =========================================================

CREATE TABLE blocks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,

    block_name VARCHAR(20) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_blocks_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    UNIQUE KEY uq_block (
        society_id,
        block_name
    )

) ENGINE=InnoDB;

-- =========================================================
-- UNITS / FLATS
-- =========================================================

CREATE TABLE units (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,
    block_id BIGINT UNSIGNED NULL,

    unit_number VARCHAR(20) NOT NULL,

    floor_number VARCHAR(10),

    unit_type ENUM(
        'flat',
        'villa',
        'shop',
        'office'
    ) DEFAULT 'flat',

    area_sqft DECIMAL(10,2),

    occupancy_status ENUM(
        'occupied',
        'vacant',
        'maintenance'
    ) DEFAULT 'occupied',

    is_active TINYINT(1) DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_units_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_units_block
        FOREIGN KEY (block_id)
        REFERENCES blocks(id)
        ON DELETE SET NULL,

    UNIQUE KEY uq_unit (
        society_id,
        unit_number
    ),

    INDEX idx_unit_block (block_id),
    INDEX idx_unit_status (occupancy_status)

) ENGINE=InnoDB;

-- =========================================================
-- UNIT RESIDENTS
-- =========================================================

CREATE TABLE unit_residents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    unit_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,

    resident_type ENUM(
        'owner',
        'tenant',
        'family_member'
    ) NOT NULL,

    is_primary TINYINT(1) DEFAULT 0,

    move_in_date DATE,
    move_out_date DATE NULL,

    is_active TINYINT(1) DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_unit_resident_unit
        FOREIGN KEY (unit_id)
        REFERENCES units(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_unit_resident_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    UNIQUE KEY uq_unit_resident (
        unit_id,
        user_id
    )

) ENGINE=InnoDB;

-- =========================================================
-- MAINTENANCE INVOICES
-- =========================================================

CREATE TABLE maintenance_invoices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,
    unit_id BIGINT UNSIGNED NOT NULL,

    invoice_number VARCHAR(50) NOT NULL,

    billing_year INT NOT NULL,
    billing_month TINYINT NOT NULL,

    amount DECIMAL(12,2) NOT NULL,
    late_fee DECIMAL(12,2) DEFAULT 0.00,

    total_amount DECIMAL(12,2)
        GENERATED ALWAYS AS (
            amount + late_fee
        ) STORED,

    due_date DATE NOT NULL,

    status ENUM(
        'Pending',
        'Paid',
        'Partial',
        'Overdue',
        'Cancelled'
    ) DEFAULT 'Pending',

    notes TEXT,

    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_invoice_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_invoice_unit
        FOREIGN KEY (unit_id)
        REFERENCES units(id)
        ON DELETE CASCADE,

    UNIQUE KEY uq_invoice (
        unit_id,
        billing_year,
        billing_month
    ),

    UNIQUE KEY uq_invoice_number (
        invoice_number
    ),

    INDEX idx_invoice_status (status),
    INDEX idx_invoice_due_date (due_date)

) ENGINE=InnoDB;

-- =========================================================
-- PAYMENT TRANSACTIONS
-- =========================================================

CREATE TABLE payment_transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    invoice_id BIGINT UNSIGNED NOT NULL,

    transaction_number VARCHAR(100),

    payment_gateway VARCHAR(50),

    payment_method ENUM(
        'cash',
        'upi',
        'bank_transfer',
        'card',
        'cheque'
    ) NOT NULL,

    amount DECIMAL(12,2) NOT NULL,

    gateway_response TEXT,

    status ENUM(
        'Pending',
        'Success',
        'Failed',
        'Refunded'
    ) DEFAULT 'Pending',

    paid_at DATETIME NULL,

    receipt_number VARCHAR(100),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payment_invoice
        FOREIGN KEY (invoice_id)
        REFERENCES maintenance_invoices(id)
        ON DELETE CASCADE,

    INDEX idx_payment_invoice (invoice_id),
    INDEX idx_payment_status (status)

) ENGINE=InnoDB;

-- =========================================================
-- EXPENSES
-- =========================================================

CREATE TABLE expenses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,

    title VARCHAR(255) NOT NULL,

    amount DECIMAL(12,2) NOT NULL,

    expense_date DATE NOT NULL,

    vendor_name VARCHAR(255),

    payment_method ENUM(
        'cash',
        'upi',
        'bank_transfer',
        'card',
        'cheque'
    ),

    notes TEXT,

    attachment_url VARCHAR(500),

    created_by BIGINT UNSIGNED NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_expense_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_expense_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_expense_date (expense_date)

) ENGINE=InnoDB;

-- =========================================================
-- NOTICES
-- =========================================================

CREATE TABLE notices (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,

    title VARCHAR(255) NOT NULL,

    details TEXT NOT NULL,

    notice_type ENUM(
        'general',
        'maintenance',
        'emergency',
        'event'
    ) DEFAULT 'general',

    publish_date DATETIME DEFAULT CURRENT_TIMESTAMP,

    expiry_date DATETIME NULL,

    attachment_url VARCHAR(500),

    created_by BIGINT UNSIGNED NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_notice_society
        FOREIGN KEY (society_id)
        REFERENCES societies(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_notice_user
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL

) ENGINE=InnoDB;

-- =========================================================
-- COMPLAINTS
-- =========================================================

CREATE TABLE complaints (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    society_id BIGINT UNSIGNED NOT NULL,

    unit_id BIGINT UNSIGNED NOT NULL,

    created_by BIGINT UNSIGNED NOT NULL,

    assigned_to BIGINT UNSIGNED NULL,

    title VARCHAR(255) NOT NULL,

    details TEXT NOT NULL,

    priority ENUM(
        'Low',
        'Medium',
        'High',
        'Critical'
    ) DEFAULT 'Medium',

    status ENUM(
        'Open',
        'In Progress',
        'Resolved',
        'Closed'
    ) DEFAULT 'Open',

    resolution_notes TEXT,

    resolved_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

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
        ON DELETE SET NULL,

    INDEX idx_complaint_status (status),
    INDEX idx_complaint_priority (priority)

) ENGINE=InnoDB;

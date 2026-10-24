-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offers` (
    `id` VARCHAR(191) NOT NULL,
    `mercado_livre_id` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `old_price` DECIMAL(12, 2) NULL,
    `discount` INTEGER NULL,
    `image` TEXT NULL,
    `permalink` TEXT NULL,
    `affiliate_link` TEXT NULL,
    `rating` DOUBLE NULL,
    `sold_quantity` INTEGER NULL,
    `sales_rank` VARCHAR(191) NULL,
    `seller` VARCHAR(191) NULL,
    `official_store` BOOLEAN NOT NULL DEFAULT false,
    `best_seller` BOOLEAN NOT NULL DEFAULT false,
    `score` INTEGER NOT NULL DEFAULT 0,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `offer_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `offer_id` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `account_id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `sent_at` DATETIME(3) NULL,
    `message_id` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auto_messages` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `schedule_type` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `scheduled_at` DATETIME(3) NULL,
    `daily_hour` INTEGER NULL,
    `daily_minute` INTEGER NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts` (
    `id` VARCHAR(191) NOT NULL,
    `platform` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`, `platform`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `offers_mercado_livre_id_key` ON `offers`(`mercado_livre_id`);

-- CreateIndex
CREATE UNIQUE INDEX `offer_deliveries_offer_id_channel_account_id_key` ON `offer_deliveries`(`offer_id`, `channel`, `account_id`);

-- CreateIndex
CREATE INDEX `offer_deliveries_channel_sent_at_idx` ON `offer_deliveries`(`channel`, `sent_at`);

-- CreateIndex
CREATE INDEX `offer_deliveries_account_id_channel_sent_at_idx` ON `offer_deliveries`(`account_id`, `channel`, `sent_at`);

-- CreateIndex
CREATE INDEX `accounts_platform_enabled_idx` ON `accounts`(`platform`, `enabled`);

-- CreateIndex
CREATE UNIQUE INDEX `users_username_key` ON `users`(`username`);

-- AddForeignKey
ALTER TABLE `offer_deliveries` ADD CONSTRAINT `offer_deliveries_offer_id_fkey` FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

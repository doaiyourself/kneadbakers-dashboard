CREATE TABLE "discounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text,
	"line_item_id" bigint,
	"title" text NOT NULL,
	"type" text,
	"code" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"percentage" double precision DEFAULT 0,
	"fixed_amount" bigint DEFAULT 0,
	"precedence" integer
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"toss_app_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"line_index" integer NOT NULL,
	"item_title" text NOT NULL,
	"item_title_normalized" text,
	"item_code" text,
	"category_title" text,
	"category_code" text,
	"category_normalized" text,
	"dining_option" text,
	"quantity" bigint DEFAULT 1 NOT NULL,
	"price_title" text,
	"price_type" text,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"is_tax_free" boolean DEFAULT false,
	"tax_inclusive" boolean DEFAULT true,
	"option_total" bigint DEFAULT 0 NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint DEFAULT 0 NOT NULL,
	"options" jsonb,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" bigint NOT NULL,
	"order_key" text,
	"order_number" text,
	"source" text NOT NULL,
	"order_state" text NOT NULL,
	"memo" text,
	"list_price" bigint DEFAULT 0 NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"tip_amount" bigint DEFAULT 0 NOT NULL,
	"service_charge_amount" bigint DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"supply_amount" bigint DEFAULT 0 NOT NULL,
	"tax_exempt_amount" bigint DEFAULT 0 NOT NULL,
	"total_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"amount" bigint NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"acquirer" text,
	"state" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"toss_item_code" text,
	"title" text NOT NULL,
	"title_normalized" text NOT NULL,
	"category_title" text,
	"category_normalized" text,
	"category_override" text,
	"base_price" bigint,
	"is_active" boolean DEFAULT true,
	"tags" text[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_toss_item_code_unique" UNIQUE("toss_item_code")
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"range_from" timestamp with time zone,
	"range_to" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"upserted_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kakao_id" text NOT NULL,
	"email" text,
	"name" text,
	"image_url" text,
	"role" text DEFAULT 'staff' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_kakao_id_unique" UNIQUE("kakao_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"webhook_id" text PRIMARY KEY NOT NULL,
	"event_id" text,
	"delivery_id" text,
	"event_type" text NOT NULL,
	"merchant_id" bigint,
	"toss_created_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_line_item_id_order_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."order_line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lines_order" ON "order_line_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_lines_title_norm" ON "order_line_items" USING btree ("item_title_normalized");--> statement-breakpoint
CREATE INDEX "idx_lines_category_norm" ON "order_line_items" USING btree ("category_normalized");--> statement-breakpoint
CREATE INDEX "idx_orders_merchant_created" ON "orders" USING btree ("merchant_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_orders_state" ON "orders" USING btree ("order_state");--> statement-breakpoint
CREATE INDEX "idx_orders_completed_at" ON "orders" USING btree ("completed_at" DESC) WHERE "orders"."completed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payments_order" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_payments_method" ON "payments" USING btree ("method","paid_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_webhook_status" ON "webhook_events" USING btree ("status","received_at");
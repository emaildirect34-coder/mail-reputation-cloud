export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      caddy_probe_state: {
        Row: {
          checked_at: string
          failed_checks: number
          incident_since: string | null
          singleton: boolean
        }
        Insert: {
          checked_at: string
          failed_checks: number
          incident_since?: string | null
          singleton?: boolean
        }
        Update: {
          checked_at?: string
          failed_checks?: number
          incident_since?: string | null
          singleton?: boolean
        }
        Relationships: []
      }
      campaign_messages: {
        Row: {
          available_at: string | null
          campaign_id: string
          claimed_at: string | null
          clicked_at: string | null
          contact_id: string | null
          created_at: string
          delivery_state: string
          email: string
          error: string | null
          first_name: string | null
          id: string
          opened_at: string | null
          permit_granted_at: string | null
          sent_at: string | null
          server_id: string
          status: string
          unsub_token: string
          variant: number | null
          verified_click_id: string | null
        }
        Insert: {
          available_at?: string | null
          campaign_id: string
          claimed_at?: string | null
          clicked_at?: string | null
          contact_id?: string | null
          created_at?: string
          delivery_state?: string
          email: string
          error?: string | null
          first_name?: string | null
          id?: string
          opened_at?: string | null
          permit_granted_at?: string | null
          sent_at?: string | null
          server_id: string
          status?: string
          unsub_token?: string
          variant?: number | null
          verified_click_id?: string | null
        }
        Update: {
          available_at?: string | null
          campaign_id?: string
          claimed_at?: string | null
          clicked_at?: string | null
          contact_id?: string | null
          created_at?: string
          delivery_state?: string
          email?: string
          error?: string | null
          first_name?: string | null
          id?: string
          opened_at?: string | null
          permit_granted_at?: string | null
          sent_at?: string | null
          server_id?: string
          status?: string
          unsub_token?: string
          variant?: number | null
          verified_click_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_messages_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          ab_decide_at: string | null
          ab_metric: string | null
          ab_variants: Json | null
          ab_winner: number | null
          amp_html: string | null
          auto_pause_reason: string | null
          created_at: string
          created_by: string | null
          from_email: string
          from_name: string
          html: string
          id: string
          list_id: string | null
          name: string
          reply_to: string | null
          scheduled_at: string | null
          server_ids: string[]
          sponsor_offer_id: string | null
          status: string
          subject: string
          suppressed: number
          topic: string | null
          total: number
          vmta_pool_id: string | null
          weekly_digest: boolean
        }
        Insert: {
          ab_decide_at?: string | null
          ab_metric?: string | null
          ab_variants?: Json | null
          ab_winner?: number | null
          amp_html?: string | null
          auto_pause_reason?: string | null
          created_at?: string
          created_by?: string | null
          from_email: string
          from_name: string
          html: string
          id?: string
          list_id?: string | null
          name: string
          reply_to?: string | null
          scheduled_at?: string | null
          server_ids?: string[]
          sponsor_offer_id?: string | null
          status?: string
          subject: string
          suppressed?: number
          topic?: string | null
          total?: number
          vmta_pool_id?: string | null
          weekly_digest?: boolean
        }
        Update: {
          ab_decide_at?: string | null
          ab_metric?: string | null
          ab_variants?: Json | null
          ab_winner?: number | null
          amp_html?: string | null
          auto_pause_reason?: string | null
          created_at?: string
          created_by?: string | null
          from_email?: string
          from_name?: string
          html?: string
          id?: string
          list_id?: string | null
          name?: string
          reply_to?: string | null
          scheduled_at?: string | null
          server_ids?: string[]
          sponsor_offer_id?: string | null
          status?: string
          subject?: string
          suppressed?: number
          topic?: string | null
          total?: number
          vmta_pool_id?: string | null
          weekly_digest?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_sponsor_offer_id_fkey"
            columns: ["sponsor_offer_id"]
            isOneToOne: false
            referencedRelation: "sponsor_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_vmta_pool_id_fkey"
            columns: ["vmta_pool_id"]
            isOneToOne: false
            referencedRelation: "vmta_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_lists: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          quarantine_reason: string | null
          quarantined_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          quarantine_reason?: string | null
          quarantined_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          quarantine_reason?: string | null
          quarantined_at?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          email: string
          email_md5: string | null
          first_name: string | null
          id: string
          list_id: string
          status: string
          time_zone: string | null
        }
        Insert: {
          created_at?: string
          email: string
          email_md5?: string | null
          first_name?: string | null
          id?: string
          list_id: string
          status?: string
          time_zone?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          email_md5?: string | null
          first_name?: string | null
          id?: string
          list_id?: string
          status?: string
          time_zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_alerts: {
        Row: {
          campaign_id: string
          campaign_name: string
          created_at: string
          id: string
          isp: string
          rate: number
          rule: string
          sample_size: number
        }
        Insert: {
          campaign_id: string
          campaign_name: string
          created_at?: string
          id?: string
          isp: string
          rate: number
          rule: string
          sample_size: number
        }
        Update: {
          campaign_id?: string
          campaign_name?: string
          created_at?: string
          id?: string
          isp?: string
          rate?: number
          rule?: string
          sample_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "delivery_alerts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_events: {
        Row: {
          campaign_id: string
          campaign_name: string
          detail: string
          event_key: string
          event_type: string
          id: string
          isp: string
          message_id: string
          occurred_at: string
          received_at: string
          recipient: string
          server_id: string
          smtp_code: number | null
          source_ipv4: string | null
        }
        Insert: {
          campaign_id: string
          campaign_name: string
          detail?: string
          event_key: string
          event_type: string
          id?: string
          isp: string
          message_id: string
          occurred_at: string
          received_at?: string
          recipient: string
          server_id: string
          smtp_code?: number | null
          source_ipv4?: string | null
        }
        Update: {
          campaign_id?: string
          campaign_name?: string
          detail?: string
          event_key?: string
          event_type?: string
          id?: string
          isp?: string
          message_id?: string
          occurred_at?: string
          received_at?: string
          recipient?: string
          server_id?: string
          smtp_code?: number | null
          source_ipv4?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "campaign_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_events_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      dmarc_reports: {
        Row: {
          created_at: string
          date_begin: string | null
          date_end: string | null
          domain: string
          id: string
          org_name: string
          passed: number
          policy: string | null
          records: Json
          report_id: string
          total: number
        }
        Insert: {
          created_at?: string
          date_begin?: string | null
          date_end?: string | null
          domain: string
          id?: string
          org_name: string
          passed?: number
          policy?: string | null
          records?: Json
          report_id: string
          total?: number
        }
        Update: {
          created_at?: string
          date_begin?: string | null
          date_end?: string | null
          domain?: string
          id?: string
          org_name?: string
          passed?: number
          policy?: string | null
          records?: Json
          report_id?: string
          total?: number
        }
        Relationships: []
      }
      finance_entries: {
        Row: {
          account_id: string
          amount_cents: number
          campaign_id: string | null
          category: string
          created_at: string
          created_by: string
          currency: string
          description: string
          due_on: string | null
          external_id: string
          id: string
          kind: string
          occurred_on: string
          offer_id: string | null
          source: string
          status: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          campaign_id?: string | null
          category?: string
          created_at?: string
          created_by: string
          currency?: string
          description?: string
          due_on?: string | null
          external_id: string
          id?: string
          kind: string
          occurred_on: string
          offer_id?: string | null
          source?: string
          status?: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          campaign_id?: string | null
          category?: string
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          due_on?: string | null
          external_id?: string
          id?: string
          kind?: string
          occurred_on?: string
          offer_id?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sponsor_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_entries_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_entries_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "sponsor_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_notifications: {
        Row: {
          channel: string
          claimed_at: string
          event_key: string
          sent_at: string | null
        }
        Insert: {
          channel: string
          claimed_at?: string
          event_key: string
          sent_at?: string | null
        }
        Update: {
          channel?: string
          claimed_at?: string
          event_key?: string
          sent_at?: string | null
        }
        Relationships: []
      }
      managed_servers: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          external_id: string | null
          id: string
          ipv4: string | null
          label: string
          monthly_price: number | null
          plan: string | null
          provider: string
          region: string | null
          status: string
          synced_at: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          ipv4?: string | null
          label: string
          monthly_price?: number | null
          plan?: string | null
          provider: string
          region?: string | null
          status?: string
          synced_at?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string | null
          id?: string
          ipv4?: string | null
          label?: string
          monthly_price?: number | null
          plan?: string | null
          provider?: string
          region?: string | null
          status?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_servers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company: string | null
          created_at: string
          full_name: string | null
          id: string
          plan: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          plan?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          plan?: string
        }
        Relationships: []
      }
      provider_accounts: {
        Row: {
          auth_type: string
          checked_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          info: Json
          label: string
          provider: string
          secret: string
          status: string
        }
        Insert: {
          auth_type?: string
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          info?: Json
          label: string
          provider: string
          secret: string
          status?: string
        }
        Update: {
          auth_type?: string
          checked_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          info?: Json
          label?: string
          provider?: string
          secret?: string
          status?: string
        }
        Relationships: []
      }
      recipient_digest_preferences: {
        Row: {
          email_md5: string
        }
        Insert: {
          email_md5: string
        }
        Update: {
          email_md5?: string
        }
        Relationships: []
      }
      recipient_snoozes: {
        Row: {
          email_md5: string
          until_at: string
        }
        Insert: {
          email_md5: string
          until_at: string
        }
        Update: {
          email_md5?: string
          until_at?: string
        }
        Relationships: []
      }
      recipient_topic_preferences: {
        Row: {
          email_md5: string
          topics: string[]
        }
        Insert: {
          email_md5: string
          topics: string[]
        }
        Update: {
          email_md5?: string
          topics?: string[]
        }
        Relationships: []
      }
      recipient_weekly_preferences: {
        Row: {
          email_md5: string
        }
        Insert: {
          email_md5: string
        }
        Update: {
          email_md5?: string
        }
        Relationships: []
      }
      sending_domains: {
        Row: {
          account_id: string | null
          checked_at: string | null
          checks: Json
          created_at: string
          created_by: string | null
          dkim_priv_a: string
          dkim_priv_b: string
          dkim_pub_a: string
          dkim_pub_b: string
          domain: string
          id: string
          ip: string | null
          selector_a: string
          selector_b: string
          synced_at: string | null
          tracking_host: string | null
          zone_id: string | null
        }
        Insert: {
          account_id?: string | null
          checked_at?: string | null
          checks?: Json
          created_at?: string
          created_by?: string | null
          dkim_priv_a: string
          dkim_priv_b: string
          dkim_pub_a: string
          dkim_pub_b: string
          domain: string
          id?: string
          ip?: string | null
          selector_a: string
          selector_b: string
          synced_at?: string | null
          tracking_host?: string | null
          zone_id?: string | null
        }
        Update: {
          account_id?: string | null
          checked_at?: string | null
          checks?: Json
          created_at?: string
          created_by?: string | null
          dkim_priv_a?: string
          dkim_priv_b?: string
          dkim_pub_a?: string
          dkim_pub_b?: string
          domain?: string
          id?: string
          ip?: string | null
          selector_a?: string
          selector_b?: string
          synced_at?: string | null
          tracking_host?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sending_domains_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      server_agents: {
        Row: {
          agent_version: string | null
          applied_hash: string | null
          config_hash: string | null
          created_at: string
          kumo_version: string | null
          last_error: string | null
          last_seen: string | null
          metrics: Json
          server_id: string
          status: string
          token_hash: string
          vmta_config_hash: string | null
          vmta_inventory_revision: string
        }
        Insert: {
          agent_version?: string | null
          applied_hash?: string | null
          config_hash?: string | null
          created_at?: string
          kumo_version?: string | null
          last_error?: string | null
          last_seen?: string | null
          metrics?: Json
          server_id: string
          status?: string
          token_hash: string
          vmta_config_hash?: string | null
          vmta_inventory_revision?: string
        }
        Update: {
          agent_version?: string | null
          applied_hash?: string | null
          config_hash?: string | null
          created_at?: string
          kumo_version?: string | null
          last_error?: string | null
          last_seen?: string | null
          metrics?: Json
          server_id?: string
          status?: string
          token_hash?: string
          vmta_config_hash?: string | null
          vmta_inventory_revision?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_agents_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: true
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_domain_bindings: {
        Row: {
          created_at: string
          domain_id: string
          id: string
          installed_at: string | null
          last_error: string | null
          server_id: string
          status: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          id?: string
          installed_at?: string | null
          last_error?: string | null
          server_id: string
          status?: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          id?: string
          installed_at?: string | null
          last_error?: string | null
          server_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_domain_bindings_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "sending_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_domain_bindings_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      server_ips: {
        Row: {
          active: boolean
          address: string
          checked_at: string | null
          family: number
          id: string
          pool_id: string | null
          quarantine_reason: string | null
          quarantined_at: string | null
          rdns: string | null
          server_id: string
          synced_at: string
        }
        Insert: {
          active?: boolean
          address: string
          checked_at?: string | null
          family: number
          id?: string
          pool_id?: string | null
          quarantine_reason?: string | null
          quarantined_at?: string | null
          rdns?: string | null
          server_id: string
          synced_at?: string
        }
        Update: {
          active?: boolean
          address?: string
          checked_at?: string | null
          family?: number
          id?: string
          pool_id?: string | null
          quarantine_reason?: string | null
          quarantined_at?: string | null
          rdns?: string | null
          server_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_ips_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "vmta_pools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "server_ips_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "managed_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_accounts: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          id: string
          last_error: string | null
          name: string
          provider: string
          status: string
          synced_at: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          last_error?: string | null
          name: string
          provider?: string
          status?: string
          synced_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          last_error?: string | null
          name?: string
          provider?: string
          status?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      sponsor_credentials: {
        Row: {
          account_id: string
          api_key: string
        }
        Insert: {
          account_id: string
          api_key: string
        }
        Update: {
          account_id?: string
          api_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_credentials_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "sponsor_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_offers: {
        Row: {
          account_id: string
          category: string
          created_at: string
          currency: string
          daily_cap: number | null
          external_id: string | null
          geo: string[]
          html: string
          id: string
          model: string
          monthly_cap: number | null
          name: string
          payout: number
          rules: string
          status: string
          subject: string
          synced_at: string | null
          tracking_url: string
        }
        Insert: {
          account_id: string
          category?: string
          created_at?: string
          currency?: string
          daily_cap?: number | null
          external_id?: string | null
          geo?: string[]
          html?: string
          id?: string
          model?: string
          monthly_cap?: number | null
          name: string
          payout?: number
          rules?: string
          status?: string
          subject?: string
          synced_at?: string | null
          tracking_url?: string
        }
        Update: {
          account_id?: string
          category?: string
          created_at?: string
          currency?: string
          daily_cap?: number | null
          external_id?: string | null
          geo?: string[]
          html?: string
          id?: string
          model?: string
          monthly_cap?: number | null
          name?: string
          payout?: number
          rules?: string
          status?: string
          subject?: string
          synced_at?: string | null
          tracking_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_offers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "sponsor_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_postbacks: {
        Row: {
          account_id: string
          created_at: string
          hits: number
          last_at: string | null
          token_hash: string
        }
        Insert: {
          account_id: string
          created_at?: string
          hits?: number
          last_at?: string | null
          token_hash: string
        }
        Update: {
          account_id?: string
          created_at?: string
          hits?: number
          last_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_postbacks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "sponsor_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressions: {
        Row: {
          created_at: string
          email_md5: string
          reason: string
          source: string | null
        }
        Insert: {
          created_at?: string
          email_md5: string
          reason?: string
          source?: string | null
        }
        Update: {
          created_at?: string
          email_md5?: string
          reason?: string
          source?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vmta_pools: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          purpose: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          purpose?: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          purpose?: string
          status?: string
        }
        Relationships: []
      }
      warmup_plans: {
        Row: {
          created_at: string
          created_by: string | null
          current_day: number
          daily_limits: number[]
          id: string
          ip_id: string
          isp: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_day?: number
          daily_limits: number[]
          id?: string
          ip_id: string
          isp: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_day?: number
          daily_limits?: number[]
          id?: string
          ip_id?: string
          isp?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "warmup_plans_ip_id_fkey"
            columns: ["ip_id"]
            isOneToOne: false
            referencedRelation: "server_ips"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          events: string[]
          fail_count: number
          id: string
          last_error: string | null
          last_sent_at: string | null
          last_status: number | null
          secret: string
          sent_count: number
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          events?: string[]
          fail_count?: number
          id?: string
          last_error?: string | null
          last_sent_at?: string | null
          last_status?: number | null
          secret: string
          sent_count?: number
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          events?: string[]
          fail_count?: number
          id?: string
          last_error?: string | null
          last_sent_at?: string | null
          last_status?: number | null
          secret?: string
          sent_count?: number
          url?: string
        }
        Relationships: []
      }
      worker_tasks: {
        Row: {
          allowed_paths: string[]
          assigned_by: string | null
          created_at: string
          description: string | null
          id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          allowed_paths?: string[]
          assigned_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          allowed_paths?: string[]
          assigned_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_suppressions: {
        Args: { _reason: string; _source: string; _values: string[] }
        Returns: number
      }
      agent_campaign_holds: { Args: { _server: string }; Returns: string[] }
      agent_campaign_releases: {
        Args: { _ids: string[]; _server: string }
        Returns: string[]
      }
      agent_confirm_suppressions: {
        Args: { _ids: string[]; _server: string }
        Returns: string[]
      }
      agent_may_inject: {
        Args: { _id: string; _server: string }
        Returns: boolean
      }
      campaign_audience_page:
        | {
            Args: { _after: string; _list: string; _with_time_zone: boolean }
            Returns: {
              email: string
              first_name: string
              id: string
              suppressed: boolean
              time_zone: string
            }[]
          }
        | {
            Args: {
              _after: string
              _digest: boolean
              _list: string
              _with_time_zone: boolean
            }
            Returns: {
              email: string
              first_name: string
              format_excluded: boolean
              id: string
              suppressed: boolean
              time_zone: string
            }[]
          }
      campaign_can_claim: {
        Args: {
          _campaign: Database["public"]["Tables"]["campaigns"]["Row"]
          _server: string
        }
        Returns: boolean
      }
      campaign_stats: {
        Args: never
        Returns: {
          campaign_id: string
          failed: number
          queued: number
          sent: number
        }[]
      }
      campaign_sunset_contacts: {
        Args: { _days: number; _ids: string[] }
        Returns: string[]
      }
      campaign_sunset_contacts_by_isp: {
        Args: { _ids: string[] }
        Returns: string[]
      }
      claim_campaign_messages: {
        Args: { _limit: number; _server: string }
        Returns: {
          available_at: string | null
          campaign_id: string
          claimed_at: string | null
          clicked_at: string | null
          contact_id: string | null
          created_at: string
          delivery_state: string
          email: string
          error: string | null
          first_name: string | null
          id: string
          opened_at: string | null
          permit_granted_at: string | null
          sent_at: string | null
          server_id: string
          status: string
          unsub_token: string
          variant: number | null
          verified_click_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_incident_notification: {
        Args: { _channel: string; _key: string }
        Returns: boolean
      }
      decide_ab_winners: { Args: never; Returns: undefined }
      delivery_engagement_anomalies: {
        Args: never
        Returns: {
          accepted: number
          baseline_accepted: number
          baseline_campaigns: number
          baseline_engaged: number
          campaign_id: string
          campaign_name: string
          engaged: number
          first_at: string
          isp: string
        }[]
      }
      delivery_engagement_cohort: {
        Args: { _campaign: string; _isp: string }
        Returns: {
          accepted: number
          engaged: number
          first_at: string
          last_at: string
        }[]
      }
      delivery_log_summary: {
        Args: never
        Returns: {
          bounced: number
          complaints: number
          deferred: number
          delivered: number
          events: number
        }[]
      }
      finance_campaign_deliveries: {
        Args: { _from: string; _to: string }
        Returns: {
          campaign_id: string
          campaign_name: string
          delivered: number
        }[]
      }
      finance_campaign_metrics: {
        Args: { _from: string; _to: string }
        Returns: {
          account_id: string
          campaign_id: string
          campaign_name: string
          delivered: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_contacts_with_time_zones: {
        Args: { _contacts: Json; _list: string }
        Returns: undefined
      }
      ingest_attributed_delivery_events: {
        Args: { _events: Json; _server: string }
        Returns: number
      }
      ingest_delivery_events: {
        Args: { _events: Json; _server: string }
        Returns: number
      }
      read_recipient_preferences: { Args: { _token: string }; Returns: Json }
      record_caddy_probe: {
        Args: { _checked_at: string; _healthy: boolean }
        Returns: string
      }
      record_sponsor_postback: {
        Args: {
          _account: string
          _amount: number
          _by: string
          _campaign: string
          _currency: string
          _description: string
          _external_id: string
          _offer: string
          _status: string
        }
        Returns: boolean
      }
      register_verified_campaign_click: {
        Args: { _id: string }
        Returns: string
      }
      set_recipient_digest: { Args: { _token: string }; Returns: string }
      set_recipient_preferences: {
        Args: { _token: string; _weekly: boolean }
        Returns: string
      }
      set_recipient_snooze: {
        Args: { _days: number; _token: string }
        Returns: string
      }
      set_recipient_topics: {
        Args: { _token: string; _topics: string[] }
        Returns: string
      }
      source_isp_history: {
        Args: { _domains: string[]; _server: string }
        Returns: {
          delivered: number
          domain: string
          sample: number
          server_id: string
          source_ipv4: string
        }[]
      }
      unsubscribe_campaign_message: {
        Args: { _server?: string; _token: string }
        Returns: {
          campaign_id: string
          email: string
          newly_suppressed: boolean
        }[]
      }
    }
    Enums: {
      app_role: "superadmin" | "worker"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["superadmin", "worker"],
    },
  },
} as const

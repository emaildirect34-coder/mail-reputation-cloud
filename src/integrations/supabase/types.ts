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
      audit_log: {
        Row: { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; summary: Json; created_at: string }
        Insert: { actor_id?: string | null; action: string; entity_type: string; entity_id?: string | null; summary?: Json }
        Update: never
        Relationships: []
      }
      campaign_exclusions: {
        Row: { campaign_id: string; contact_id: string | null; email_md5: string; reason: string; created_at: string }
        Insert: { campaign_id: string; contact_id?: string | null; email_md5: string; reason: string }
        Update: never
        Relationships: [{ foreignKeyName: 'campaign_exclusions_campaign_id_fkey'; columns: ['campaign_id']; isOneToOne: false; referencedRelation: 'campaigns'; referencedColumns: ['id'] }]
      }
      recipient_sponsor_blocks: {
        Row: { recipient_md5: string; brand_id: string; blocked_at: string }
        Insert: { recipient_md5: string; brand_id: string; blocked_at?: string }
        Update: never
        Relationships: []
      }
      sender_reply_channels: {
        Row: { profile_id: string; token_hash: string }
        Insert: { profile_id: string; token_hash: string }
        Update: { token_hash?: string }
        Relationships: []
      }
      campaign_followup_tasks: {
        Row: { id: string; campaign_id: string; task_key: string; title: string; status: 'open' | 'done'; note: string; created_at: string; completed_at: string | null }
        Insert: { campaign_id: string; task_key: string; title: string; status?: 'open' | 'done'; note?: string }
        Update: { status?: 'open' | 'done'; note?: string; completed_at?: string | null }
        Relationships: [{ foreignKeyName: 'campaign_followup_tasks_campaign_id_fkey'; columns: ['campaign_id']; isOneToOne: false; referencedRelation: 'campaigns'; referencedColumns: ['id'] }]
      }
      email_templates: {
        Row: { id: string; name: string; subject: string; html: string; version: number; created_at: string; updated_at: string }
        Insert: { name: string; subject?: string; html?: string }
        Update: { name?: string; subject?: string; html?: string; version?: number; updated_at?: string }
        Relationships: []
      }
      email_template_versions: {
        Row: { template_id: string; version: number; created_at: string; snapshot: Json }
        Insert: never
        Update: never
        Relationships: [{ foreignKeyName: 'email_template_versions_template_id_fkey'; columns: ['template_id']; isOneToOne: false; referencedRelation: 'email_templates'; referencedColumns: ['id'] }]
      }
      email_content_blocks: {
        Row: { id: string; name: string; html: string; created_at: string; updated_at: string }
        Insert: { name: string; html: string }
        Update: { name?: string; html?: string; updated_at?: string }
        Relationships: []
      }
      server_config_revisions: {
        Row: { server_id: string; config_hash: string; first_seen_at: string }
        Insert: { server_id: string; config_hash: string }
        Update: never
        Relationships: [{ foreignKeyName: 'server_config_revisions_server_id_fkey'; columns: ['server_id']; isOneToOne: false; referencedRelation: 'managed_servers'; referencedColumns: ['id'] }]
      }
      operational_job_runs: {
        Row: { id: string; job: string; status: string; started_at: string; finished_at: string | null; duration_ms: number | null; created_at: string }
        Insert: { job: string; status: string }
        Update: { status?: string; finished_at?: string | null; duration_ms?: number | null }
        Relationships: []
      }
      sender_profile_replies: {
        Row: { id: string; profile_id: string; message_id: string; source_hash: string; received_at: string; handled_at: string | null }
        Insert: never
        Update: { handled_at: string | null }
        Relationships: [{ foreignKeyName: "sender_profile_replies_message_id_fkey"; columns: ["message_id"]; isOneToOne: false; referencedRelation: "campaign_messages"; referencedColumns: ["id"] }]
      }
      contact_segments: {
        Row: { id: string; list_id: string; name: string; provider: string | null; preference: string; revision: string }
        Insert: { list_id: string; name: string; provider: string | null; preference: string }
        Update: { name?: string; provider?: string | null; preference?: string; revision?: string }
        Relationships: []
      }
      campaign_no_send_days: {
        Row: { day: string; reason: string }
        Insert: never
        Update: never
        Relationships: []
      }
      campaign_notes: {
        Row: { id: string; campaign_id: string; category: string; note: string; created_at: string; created_by: string }
        Insert: { campaign_id: string; category: string; note: string; created_by: string }
        Update: never
        Relationships: []
      }
      sponsor_offer_daily_targets: {
        Row: { offer_id: string; daily_limit: number }
        Insert: { offer_id: string; daily_limit: number }
        Update: { daily_limit?: number }
        Relationships: []
      }
      sponsor_postback_rejections: {
        Row: { account_id: string; bucket: string; reason: string; reference_hash: string; attempts: number; last_seen: string }
        Insert: never
        Update: never
        Relationships: []
      }
      sponsor_postback_diagnostics: {
        Row: { account_id: string; token_hash: string; expected_event: string; expires_at: string; checked_at: string | null; succeeded: boolean | null; detail: string | null }
        Insert: { account_id: string; token_hash: string; expected_event: string; expires_at: string; checked_at?: string | null; succeeded?: boolean | null; detail?: string | null }
        Update: { checked_at?: string | null; succeeded?: boolean | null; detail?: string | null }
        Relationships: []
      }
      sponsor_link_monitor: {
        Row: { campaign_id: string; checked_at: string | null; next_check_at: string; lease_id: string | null; active_until: string; result: Json | null; baseline: Json; alert_since: string | null }
        Insert: never
        Update: never
        Relationships: [{ foreignKeyName: "sponsor_link_monitor_campaign_id_fkey"; columns: ["campaign_id"]; isOneToOne: true; referencedRelation: "campaigns"; referencedColumns: ["id"] }]
      }
      sponsor_conversion_reports: {
        Row: { campaign_id: string; date_from: string; date_to: string; transaction_ids: string[]; imported_at: string; imported_by: string }
        Insert: { campaign_id: string; date_from: string; date_to: string; transaction_ids: string[]; imported_at?: string; imported_by: string }
        Update: { transaction_ids?: string[]; imported_at?: string; imported_by?: string }
        Relationships: [{ foreignKeyName: "sponsor_conversion_reports_campaign_id_fkey"; columns: ["campaign_id"]; isOneToOne: false; referencedRelation: "campaigns"; referencedColumns: ["id"] }]
      }
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
      campaign_frequency_policy: {
        Row: {
          hours: number
          singleton: boolean
        }
        Insert: {
          hours?: number
          singleton?: boolean
        }
        Update: {
          hours?: number
          singleton?: boolean
        }
        Relationships: []
      }
      campaign_messages: {
        Row: {
          expired_at: string | null
          available_at: string | null
          campaign_id: string
          claimed_at: string | null
          clicked_at: string | null
          contact_id: string | null
          created_at: string
          delivery_state: string
          delivery_wave: number | null
          send_time_zone: string | null
          email: string
          error: string | null
          first_name: string | null
          id: string
          injection_uncertain_at: string | null
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
          send_time_zone?: string | null
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
          injection_uncertain_at?: string | null
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
          injection_uncertain_at?: string | null
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
      campaign_placement_monitors: {
        Row: {
          campaign_id: string
          completed_at: string | null
          expires_at: string
          observed_at: string | null
          placement_id: string
          seeds: Json
          server_id: string
          test_campaign_id: string
          unsubscribe_https_verified_at: string | null
        }
        Insert: {
          campaign_id: string
          completed_at?: string | null
          expires_at: string
          observed_at?: string | null
          placement_id: string
          seeds: Json
          server_id: string
          test_campaign_id: string
          unsubscribe_https_verified_at?: string | null
        }
        Update: {
          campaign_id?: string
          completed_at?: string | null
          expires_at?: string
          observed_at?: string | null
          placement_id?: string
          seeds?: Json
          server_id?: string
          test_campaign_id?: string
          unsubscribe_https_verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_placement_monitors_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_placement_monitors_test_campaign_id_fkey"
            columns: ["test_campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
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
          fatigue_protection: boolean
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
          purchase_thank_you: boolean
          requires_placement: boolean
          placement_probe_token: string | null
          placement_probe_of: string | null
        }
        Insert: {
          approval_required?: boolean
          sender_profile_id?: string
          history_digest_source?: string
          send_expires_at?: string | null
          ab_decide_at?: string | null
          send_window_start?: number | null
          send_window_end?: number | null
          sponsor_brand_id?: string | null
          send_priority?: number
          ab_metric?: string | null
          ab_variants?: Json | null
          ab_winner?: number | null
          amp_html?: string | null
          auto_pause_reason?: string | null
          created_at?: string
          created_by?: string | null
          fatigue_protection?: boolean
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
          requires_placement?: boolean
        }
        Update: {
          ab_decide_at?: string | null
          send_priority?: number
          ab_metric?: string | null
          ab_variants?: Json | null
          ab_winner?: number | null
          amp_html?: string | null
          auto_pause_reason?: string | null
          created_at?: string
          created_by?: string | null
          fatigue_protection?: boolean
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
      sender_profiles: {
        Row: { id: string; label: string; from_name: string; from_email: string; reply_to: string | null; enabled: boolean;
          from_verified_at: string | null; reply_verified_at: string | null; created_at: string }
        Insert: { label: string; from_name: string; from_email: string; reply_to: string | null; enabled?: boolean }
        Update: { label?: string; from_name?: string; from_email?: string; reply_to?: string | null; enabled?: boolean }
        Relationships: []
      }
      operations_incidents: {
        Row: {
          id: string; signal_key: string; kind: 'campaign_blocked' | 'injection_uncertain' | 'agent_offline' | 'campaign_stalled'; title: string;
          detail: string; server_id: string | null; affected_campaigns: Json; affected_messages: number | null;
          started_at: string; last_observed_at: string; signal_cleared_at: string | null; assigned_to: string | null;
          resolved_at: string | null; resolved_by: string | null; resolution_note: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      campaign_versions: {
        Row: { campaign_id: string; version: number; created_at: string; source: 'existing' | 'created' | 'edited' | 'sponsor'; snapshot: Json }
        Insert: never
        Update: never
        Relationships: []
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
          maintenance_since: string | null
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
      recipient_mailbox_holds: {
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
          brand_id: string | null
          category: string
          created_at: string
          currency: string
          daily_cap: number | null
          delivery_paused: boolean
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
          delivery_paused?: boolean
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
      delivery_provider_holds: {
        Row: { provider: string; sender_domain: string; reason: string; occurred_at: string; until_at: string | null }
        Insert: { provider: string; sender_domain: string; reason: string; occurred_at: string; until_at?: string | null }
        Update: { reason?: string; occurred_at?: string; until_at?: string | null }
        Relationships: []
      }
      campaign_placement_releases: {
        Row: { campaign_id: string; provider: string; released_at: string }
        Insert: { campaign_id: string; provider: string; released_at?: string }
        Update: { released_at?: string }
        Relationships: []
      }
      sponsor_purchase_settings: {
        Row: { offer_id: string; event_key: string; thank_you_enabled: boolean; review_url: string | null; consent_list_id: string | null }
        Insert: { offer_id: string; event_key: string; thank_you_enabled?: boolean; review_url?: string | null; consent_list_id?: string | null }
        Update: { event_key?: string; thank_you_enabled?: boolean; review_url?: string | null; consent_list_id?: string | null }
        Relationships: []
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
      subscription_confirmations: {
        Row: {
          confirmed_at: string
          email_md5: string
          list_id: string
          proof_payload: string | null
          proof_signature: string | null
          token_hash: string
        }
        Insert: {
          confirmed_at?: string
          email_md5: string
          list_id: string
          proof_payload?: string | null
          proof_signature?: string | null
          token_hash: string
        }
        Update: {
          confirmed_at?: string
          email_md5?: string
          list_id?: string
          proof_payload?: string | null
          proof_signature?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_confirmations_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
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
      read_weekly_operations_report: { Args: { _now?: string }; Returns: Json }
      erase_contact_data: { Args: { _email_md5: string }; Returns: Json }
      record_sender_profile_reply: { Args: { _token_hash: string; _message: string; _domain: string; _source_hash: string; _received_at: string }; Returns: string }
      read_campaign_outcome_comparison: { Args: { _left: string; _right: string }; Returns: Json }
      save_email_template: { Args: { _id: string | null; _name: string; _subject: string; _html: string }; Returns: { id: string; version: number }[] }
      restore_email_template_version: { Args: { _id: string; _version: number }; Returns: { id: string; version: number }[] }
      record_server_config_revision: { Args: { _server: string; _hash: string }; Returns: boolean }
      start_operational_job: { Args: { _job: string }; Returns: string }
      finish_operational_job: { Args: { _id: string; _success: boolean; _duration_ms: number }; Returns: boolean }
      preview_contact_segment: { Args: { _list: string; _segment: string | null; _provider: string | null; _preference: string }; Returns: { revision: string | null; previous: number; next: number; entering: number; leaving: number }[] }
      filter_contact_segment_page: { Args: { _list: string; _ids: string[]; _provider: string | null; _preference: string }; Returns: string[] }
      read_contact_list_insights: { Args: { _list: string }; Returns: Json }
      record_campaign_unsubscribe_reason: { Args: { _token: string; _reason: string }; Returns: boolean }
      read_campaign_unsubscribe_reasons: { Args: Record<PropertyKey, never>; Returns: { reason: string; total: number }[] }
      record_sponsor_purchase_review: { Args: { _hash: string; _rating: number; _comment: string }; Returns: boolean }
      read_sponsor_purchase_reviews: { Args: { _offer: string }; Returns: { total: number; average_rating: number | null }[] }
      read_contact_history: { Args: { _email: string }; Returns: Json }
      read_offer_contact_cohorts: { Args: { _offer: string }; Returns: { month: string | null; accepted: number; purchases: number; unsubscribed: number }[] }
      set_campaign_no_send_day: { Args: { _day: string; _reason: string | null }; Returns: boolean }
      read_operations_widgets: { Args: Record<PropertyKey, never>; Returns: Json }
      read_sponsor_offer_widgets: { Args: { _offer: string }; Returns: Json }
      log_sponsor_postback_rejection: { Args: { _account: string; _reason: string; _reference_hash: string }; Returns: undefined }
      claim_sponsor_link_checks: { Args: Record<PropertyKey, never>; Returns: { campaign_id: string; lease_id: string; html: string; tracking_url: string; offer_status: string; baseline: Json }[] }
      finish_sponsor_link_check: { Args: { _campaign: string; _lease: string; _result: Json; _baseline: Json; _alert: boolean }; Returns: boolean }
      read_sponsor_conversion_reconciliation: { Args: { _campaign: string; _from: string; _to: string; _offset: number }; Returns: Json }
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
      sponsor_followup_blocked_contacts: { Args: { _offer: string; _ids: string[] }; Returns: string[] }
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
          claimed_revision: string | null
          clicked_at: string | null
          contact_id: string | null
          created_at: string
          delivery_state: string
          email: string
          error: string | null
          first_name: string | null
          id: string
          injection_uncertain_at: string | null
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
      confirm_contact_subscription: {
        Args: {
          _email: string
          _list: string
          _proof_payload?: string
          _proof_signature?: string
          _token_hash: string
        }
        Returns: string
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
      read_campaign_delivery_by_domain: {
        Args: { _campaign: string }
        Returns: {
          accepted: number
          bounced: number
          claimed: number
          complained: number
          deferred: number
          domain: string
          injected: number
          injection_failed: number
          oldest_due_at: string
          queued: number
        }[]
      }
      read_contact_subscription_proofs: {
        Args: { _email: string; _list: string }
        Returns: {
          confirmed_at: string
          proof_payload: string
          proof_signature: string
          token_hash: string
        }[]
      }
      recipient_fatigue_until: {
        Args: { _at: string; _message: string; _recipient: string }
        Returns: string
      }
      reconcile_campaign_injections: {
        Args: { _receipts: Json; _server: string }
        Returns: number
      }
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
      record_sponsor_purchase_postback: {
        Args: Database['public']['Functions']['record_sponsor_postback']['Args'] & {
          _click_id: string; _event: string | null; _purchase_status: string | null; _public_origin: string
        }
        Returns: boolean
      }
      read_sponsor_buyers: {
        Args: { _offer: string; _offset: number }
        Returns: { email: string; purchases: number; last_purchase_at: string; subscribed: boolean; thank_you_status: string }[]
      }
      read_purchase_feedback: {
        Args: { _hash: string }
        Returns: { review_url: string | null; can_subscribe: boolean; confirmed: boolean }[]
      }
      confirm_purchase_offers: { Args: { _hash: string; _topics: string[]; _weekly: boolean; _statement: string }; Returns: string }
      start_campaign_preflight: { Args: { _campaign: string; _server: string; _placement: string; _token: string; _expires: string; _seeds: Json }; Returns: undefined }
      release_campaign_provider: { Args: { _campaign: string; _provider: string }; Returns: boolean }
      read_sponsor_delivery_quality: {
        Args: { _offer: string | null }
        Returns: { source: string; accepted: number; hard_bounces: number; complaints: number; unsubscribes: number }[]
      }
      agent_provider_holds: { Args: { _server: string }; Returns: { campaign: string; domain: string; until_at: string | null }[] }
      read_campaign_wave_status: {
        Args: { _campaign: string }
        Returns: { provider: string; wave: number; planned: number; accepted: number; deferred: number; bounced: number; complaints: number; remaining: number; state: string }[]
      }
      record_agent_smtp_scan: { Args: { _server: string; _through: string }; Returns: boolean }
      read_campaign_smtp_scans: {
        Args: { _campaign: string }
        Returns: { server_id: string; label: string; reported_at: string | null; observed_through: string | null; last_event_at: string | null; current_scan: boolean }[]
      }
      prepare_campaign_unsubscribe_probe: { Args: { _campaign: string }; Returns: { id: string; token: string }[] }
      finish_campaign_unsubscribe_probe: { Args: { _probe: string; _http_ok: boolean }; Returns: boolean }
      set_sponsor_offer_brand: { Args: { _offer: string; _name: string }; Returns: boolean }
      read_sponsor_offer_brand: { Args: { _offer: string }; Returns: string | null }
      list_sponsor_brands: { Args: Record<PropertyKey, never>; Returns: string[] }
      read_recipient_sponsor_options: { Args: { _token: string; _scope: string }; Returns: { id: string; name: string; blocked: boolean }[] }
      set_recipient_sponsor_option: { Args: { _token: string; _scope: string; _brand: string; _blocked: boolean }; Returns: string }
      sponsor_preference_blocked_contacts: { Args: { _brand: string; _ids: string[] }; Returns: string[] }
      set_server_campaign_capacity: { Args: { _server: string; _per_minute: number | null }; Returns: boolean }
      set_server_maintenance: { Args: { _server: string; _enabled: boolean }; Returns: boolean }
      read_server_maintenance: {
        Args: { _server: string }
        Returns: { maintenance_since: string | null; queued: number; claimed: number; kumo_messages: number | null; ready: boolean }[]
      }
      read_campaign_queue_priority: {
        Args: { _campaign: string }
        Returns: { server_id: string; label: string; priority: number; per_minute: number | null; reserved: number; waiting_reason: string | null }[]
      }
      read_campaign_retry_status: { Args: { _campaign: string }; Returns: { confirmed: number; uncertain: number }[] }
      expire_campaign_messages: { Args: { _server?: string | null; _campaign?: string | null; _limit?: number }; Returns: number }
      read_campaign_deadline: { Args: { _campaign: string }; Returns: { send_expires_at: string; deadline_reached: boolean; expired: number }[] }
      set_sender_domain_quota: { Args: { _domain: string; _daily_limit: number | null }; Returns: boolean }
      read_sender_domain_quota: {
        Args: { _domain: string }
        Returns: { domain: string; daily_limit: number | null; used: number; reset_at: string; exhausted: boolean }[]
      }
      read_campaign_sender_domain_quota: {
        Args: { _campaign: string }
        Returns: { domain: string; daily_limit: number | null; used: number; reset_at: string; exhausted: boolean; waiting: boolean }[]
      }
      forecast_sender_domain_queue: {
        Args: { _domain: string; _as_of: string; _through: string }
        Returns: { daily_limit: number; used: number; cohorts: Json }[]
      }
      forecast_sender_domain_draft_days: {
        Args: { _slots: Json; _window_start: number | null; _window_end: number | null; _deadline: string | null }
        Returns: { day: string; eligible: boolean; volume: number }[]
      }
      read_campaign_delivery_reconciliation: {
        Args: { _campaign: string }
        Returns: { planned: number; tracked: number; excluded_before: number; retries: number; observed_at: string; outcomes: Json }[]
      }
      sync_operations_incidents: { Args: never; Returns: boolean }
      sync_stalled_campaign_incidents: { Args: never; Returns: number }
      sender_profile_usable: {
        Args: { _profile: string; _server: string; _from_name: string; _from_email: string; _reply_to: string | null }
        Returns: boolean
      }
      issue_sender_profile_code: {
        Args: { _profile: string; _server: string; _email: string; _code: string; _hash: string; _actor: string }
        Returns: string
      }
      confirm_sender_profile_code: {
        Args: { _profile: string; _email: string; _hash: string; _actor: string }
        Returns: string
      }
      read_agent_sender_profile_codes: { Args: { _server: string; _ids: string[] }; Returns: { message_id: string; code: string }[] }
      operations_incident_assignees: { Args: never; Returns: { id: string; label: string }[] }
      manage_operations_incident: {
        Args: { _id: string; _actor: string; _action: string; _assignee?: string | null; _note?: string }
        Returns: boolean
      }
      lease_campaign_duplicate_review: { Args: { _body: string; _offer: string | null; _token: string; _renew?: boolean }; Returns: boolean }
      release_campaign_duplicate_review: { Args: { _token: string }; Returns: undefined }
      find_campaign_duplicates: {
        Args: { _body: string; _offer: string | null; _recipients: string[]; _as_of: string }
        Returns: { overlap: number; matches: Json }[]
      }
      approve_scheduled_campaign: { Args: { _campaign: string; _revision: string }; Returns: boolean }
      forecast_campaign_conflicts: {
        Args: {
          _recipients: Json; _server: string; _priority: number; _as_of: string; _cap_hours: number;
          _window_start: number | null; _window_end: number | null; _draft_deadline?: string
        }
        Returns: { overlap: number; draft_at_risk: number; campaigns: Json }[]
      }
      agent_may_inject_approved: { Args: { _server: string; _id: string; _revision: string }; Returns: boolean }
      read_scheduled_campaign_approval: {
        Args: { _campaign: string }
        Returns: {
          revision: string; approved_at: string | null; pending: boolean; changes: string[];
          subject: string; from_name: string; from_email: string; reply_to: string | null;
          html: string | null; amp_html: string | null; variants: Json | null; scheduled_at: string | null;
          list_name: string | null; recipient_count: number; servers: string[]; pool: string | null;
          sponsor_url: string | null; outdated_agents: string[]; routing_mismatch: boolean
        }[]
      }
      retry_confirmed_campaign_messages: { Args: { _campaign: string }; Returns: { requeued: number; excluded: number; uncertain: number }[] }
      close_campaign_if_idle: { Args: { _campaign: string; _server: string }; Returns: undefined }
      read_recipient_preferences: { Args: { _token: string }; Returns: Json }
      set_recipient_preferences: { Args: { _token: string; _weekly: boolean }; Returns: string }
      set_recipient_topics: { Args: { _token: string; _topics: string[] | null }; Returns: string }
      set_recipient_snooze: { Args: { _token: string; _days: number }; Returns: string }
      register_verified_campaign_click: {
        Args: { _id: string }
        Returns: string
      }
      set_recipient_digest: { Args: { _token: string }; Returns: string }
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
      start_campaign_placement_monitor: {
        Args: {
          _campaign: string
          _expires: string
          _placement: string
          _seeds: Json
          _server: string
          _token: string
        }
        Returns: undefined
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

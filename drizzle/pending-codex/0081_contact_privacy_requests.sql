BEGIN;
CREATE FUNCTION public.erase_contact_data(_email_md5 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE message_count integer; contact_count integer;
BEGIN
 IF _email_md5 !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'invalid contact hash'; END IF;
 INSERT INTO public.suppressions(email_md5,reason,source)
 VALUES(_email_md5,'manual','privacy erasure') ON CONFLICT(email_md5) DO NOTHING;

 UPDATE public.sponsor_purchases p SET feedback_hash=NULL,consent_at=NULL,consent_list_id=NULL,
   consent_topics=NULL,consent_weekly=NULL,consent_statement=NULL
 FROM public.campaign_messages m WHERE p.source_message_id=m.id AND md5(lower(btrim(m.email)))=_email_md5;

 DELETE FROM public.sender_profile_replies r USING public.campaign_messages m
 WHERE r.message_id=m.id AND md5(lower(btrim(m.email)))=_email_md5;
 DELETE FROM public.campaign_unsubscribe_reasons WHERE recipient_hash=_email_md5;
 DELETE FROM public.recipient_sponsor_blocks WHERE recipient_md5=_email_md5;
 DELETE FROM public.recipient_snoozes WHERE email_md5=_email_md5;
 DELETE FROM public.recipient_topic_preferences WHERE email_md5=_email_md5;
 DELETE FROM public.recipient_weekly_preferences WHERE email_md5=_email_md5;
 DELETE FROM public.recipient_digest_preferences WHERE email_md5=_email_md5;
 DELETE FROM public.recipient_mailbox_holds WHERE email_md5=_email_md5;
 DELETE FROM public.subscription_confirmations WHERE email_md5=_email_md5;

 UPDATE public.campaign_messages SET email='erased+'||id::text||'@redacted.invalid',first_name=NULL,error=NULL,
   unsub_token=encode(extensions.gen_random_bytes(18),'hex')
 WHERE md5(lower(btrim(email)))=_email_md5;
 GET DIAGNOSTICS message_count=ROW_COUNT;
 DELETE FROM public.contacts WHERE email_md5=_email_md5;
 GET DIAGNOSTICS contact_count=ROW_COUNT;
 RETURN jsonb_build_object('messages_anonymized',message_count,'contacts_removed',contact_count,'suppression_hash_retained',true);
END;
$$;
REVOKE ALL ON FUNCTION public.erase_contact_data(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erase_contact_data(text) TO service_role;
COMMIT;

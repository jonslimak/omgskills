ALTER TABLE analytics_events
  ADD COLUMN actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN source_id uuid,
  ADD COLUMN release_id uuid,
  ADD COLUMN device_id uuid REFERENCES device_tokens(id) ON DELETE SET NULL,
  ADD CONSTRAINT analytics_events_release_source_fk
    FOREIGN KEY (release_id, source_id)
    REFERENCES skill_releases(id, source_id)
    ON DELETE SET NULL,
  ADD CONSTRAINT analytics_events_content_fetch_shape_check
    CHECK (
      event_name <> 'content_fetch'
      OR (
        source_id IS NOT NULL
        AND release_id IS NOT NULL
      )
    );

CREATE INDEX analytics_events_content_fetch_actor_idx
  ON analytics_events(actor_user_id, created_at)
  WHERE event_name = 'content_fetch';

CREATE INDEX analytics_events_content_fetch_source_idx
  ON analytics_events(source_id, created_at)
  WHERE event_name = 'content_fetch';

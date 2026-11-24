-- Full-text search over tasks (AD-18): title weight A, the text nodes of the Tiptap description
-- weight B. Only "text" values are indexed, so node names such as "paragraph" never match.
-- jsonb_path_query_array (not the _tz variant) is immutable, which a generated column requires.
ALTER TABLE task
    ADD COLUMN search tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A')
        || setweight(
            to_tsvector(
                'english',
                coalesce(jsonb_path_query_array(description, 'strict $.**.text')::text, '')),
            'B')
    ) STORED;

CREATE INDEX task_search_idx ON task USING gin (search);

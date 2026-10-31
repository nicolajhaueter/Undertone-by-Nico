create table images (
    id           uuid primary key,
    hash         char(64)    not null unique,
    file_name    text        not null,
    content_type text        not null,
    width        integer     not null check (width > 0),
    height       integer     not null check (height > 0),
    size_bytes   bigint      not null check (size_bytes > 0),
    created_at   timestamptz not null default now()
);

create table compositions (
    id         uuid primary key,
    title      text        not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One row per piece; layer_index 0 is the back of the canvas.
-- Images are not cascaded: a referenced image can never be deleted.
create table composition_pieces (
    composition_id    uuid             not null references compositions (id) on delete cascade,
    layer_index       integer          not null check (layer_index >= 0),
    name              text             not null,
    original_image_id uuid             not null references images (id),
    cutout_image_id   uuid references images (id),
    shown             text             not null check (shown in ('original', 'cutout')),
    x                 double precision not null,
    y                 double precision not null,
    width             double precision not null check (width > 0),
    ratio             double precision not null check (ratio > 0),
    primary key (composition_id, layer_index),
    check (shown = 'original' or cutout_image_id is not null)
);

create index composition_pieces_original_image_idx on composition_pieces (original_image_id);
create index composition_pieces_cutout_image_idx on composition_pieces (cutout_image_id);

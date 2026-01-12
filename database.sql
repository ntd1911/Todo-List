CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50),
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    completed BOOLEAN DEFAULT FALSE,
    deadline TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    due_date TIMESTAMP,
    reminded BOOLEAN DEFAULT false,


    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE TABLE email_otps (
  id SERIAL PRIMARY KEY,
  email VARCHAR(100),
  otp VARCHAR(6),
  password_hash TEXT,
  verified BOOLEAN DEFAULT false,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

SELECT * FROM public.users
ORDER BY id ASC LIMIT 100

select * from public.tasks
order by id asc limit 100



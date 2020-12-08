#!/bin/sh
PGUSER=helpline PGPASSWORD=helpline PGHOST=localhost psql helpline < reset-psql.txt
redis-cli < reset-redis.txt

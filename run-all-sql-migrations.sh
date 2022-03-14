#!/bin/sh
for f in `ls sql | grep sql`
do
  echo $f
  cat sql/$f | psql
done

// @orbetra/worker — ordered pipeline consumers (E02-3) + BullMQ jobs (later stories).
export { ShardConsumer, type ConsumerDeps } from './consumer.js'
export { ShardLeaser, SHARD_COUNT } from './shards.js'
export { normalize, type HashFn } from './normalize.js'
export { writePositions, MAX_BATCH_ROWS } from './writer.js'

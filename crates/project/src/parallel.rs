//! Reading many small files is waiting for the disk, not computing: more threads than cores keep the disk busy and
//! cut the time of a cold start (first open after a restart, virus scanner looking at every file).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// How many threads to use for file reading: a multiple of the cores, because the threads mostly wait for the disk.
pub fn io_threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).saturating_mul(3).clamp(4, 32)
}

/// `f` applied to every item, on `threads` threads that take the next free item (a few slow items do not hold the
/// others up). The results come back in the order of the items.
pub fn parallel_map<T: Sync, R: Send>(items: &[T], threads: usize, f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    if items.len() < 2 || threads < 2 {
        return items.iter().map(f).collect();
    }
    let next = AtomicUsize::new(0);
    let done: Mutex<Vec<(usize, R)>> = Mutex::new(Vec::with_capacity(items.len()));
    std::thread::scope(|scope| {
        for _ in 0..threads.min(items.len()) {
            scope.spawn(|| {
                let mut mine = Vec::new();
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(item) = items.get(i) else { break };
                    mine.push((i, f(item)));
                }
                if let Ok(mut all) = done.lock() {
                    all.extend(mine);
                }
            });
        }
    });
    let mut all = done.into_inner().unwrap_or_default();
    all.sort_by_key(|(i, _)| *i);
    all.into_iter().map(|(_, r)| r).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn results_keep_the_order_of_the_items() {
        let items: Vec<u32> = (0..200).collect();
        let doubled = parallel_map(&items, 8, |n| {
            if n % 7 == 0 {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            n * 2
        });
        assert_eq!(doubled, items.iter().map(|n| n * 2).collect::<Vec<_>>());
    }

    #[test]
    fn few_items_or_one_thread_run_plainly() {
        assert_eq!(parallel_map(&[1, 2, 3], 1, |n| n + 1), vec![2, 3, 4]);
        assert_eq!(parallel_map::<u8, u8>(&[], 8, |n| *n), Vec::<u8>::new());
    }
}

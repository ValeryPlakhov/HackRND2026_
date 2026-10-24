import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/** Bounded in-memory task queue with cancellation and observable stage transitions. */
public final class JobService implements AutoCloseable {
  public interface Work {
    Object run(Context context) throws Exception;
  }

  public static final class Context {
    private final Job job;

    Context(Job job) {
      this.job = job;
    }

    public void stage(String title, int completed, int total) {
      if (Thread.currentThread().isInterrupted() || job.cancelled)
        throw new CancellationException();
      synchronized (job) {
        job.stage = title;
        job.completed = completed;
        job.total = total;
        job.updatedAt = Instant.now().toString();
        job.events.add(
            Digests.map(
                "at", job.updatedAt, "stage", title, "completed", completed, "total", total));
        if (job.events.size() > 64) job.events.remove(0);
      }
    }

    public boolean cancelled() {
      return job.cancelled || Thread.currentThread().isInterrupted();
    }
  }

  private static final class Job {
    final String id = UUID.randomUUID().toString();
    final String kind;
    final String createdAt = Instant.now().toString();
    final long sequence;
    final List<Object> events = new ArrayList<>();
    String updatedAt = createdAt;
    String state = "queued";
    String stage = "В очереди";
    int completed;
    int total;
    Object result;
    String error;
    boolean cancelled;
    Future<?> future;

    Job(String kind, long sequence) {
      this.kind = kind;
      this.sequence = sequence;
    }

    synchronized Map<String, Object> snapshot(boolean includeResult) {
      return Digests.map(
          "id",
          id,
          "kind",
          kind,
          "state",
          state,
          "stage",
          stage,
          "completed",
          completed,
          "total",
          total,
          "createdAt",
          createdAt,
          "updatedAt",
          updatedAt,
          "events",
          List.copyOf(events),
          "result",
          includeResult ? result : null,
          "error",
          error,
          "cancelled",
          cancelled);
    }
  }

  private final ConcurrentMap<String, Job> jobs = new ConcurrentHashMap<>();
  private final AtomicLong sequence = new AtomicLong();
  private final ThreadPoolExecutor executor =
      new ThreadPoolExecutor(
          2,
          2,
          30,
          TimeUnit.SECONDS,
          new ArrayBlockingQueue<>(12),
          runnable -> {
            Thread thread = new Thread(runnable, "blueprints-worker");
            thread.setDaemon(true);
            return thread;
          });

  public synchronized Map<String, Object> submit(String kind, Work work) {
    evict();
    if (jobs.size() >= 48)
      throw new IllegalArgumentException("Слишком много заданий. Очистите завершённые задания.");
    Job job = new Job(kind, sequence.incrementAndGet());
    jobs.put(job.id, job);
    try {
      job.future = executor.submit(() -> execute(job, work));
    } catch (RejectedExecutionException e) {
      jobs.remove(job.id);
      throw new IllegalArgumentException(
          "Очередь заполнена. Дождитесь завершения текущих заданий.");
    }
    return job.snapshot(false);
  }

  private void execute(Job job, Work work) {
    synchronized (job) {
      if (job.cancelled) return;
      job.state = "running";
      job.stage = "Подготовка";
      job.updatedAt = Instant.now().toString();
    }
    try {
      Object result = work.run(new Context(job));
      synchronized (job) {
        if (!job.cancelled) {
          job.result = result;
          job.state = "completed";
          job.stage = "Готово";
          job.completed = job.total;
        }
      }
    } catch (InterruptedException | CancellationException interrupted) {
      synchronized (job) {
        job.cancelled = true;
        job.state = "cancelled";
        job.stage = "Отменено";
      }
      Thread.currentThread().interrupt();
    } catch (Exception error) {
      synchronized (job) {
        if (!job.cancelled) {
          job.error = error.getClass().getSimpleName() + ": " + error.getMessage();
          job.state = "failed";
          job.stage = "Ошибка";
        }
      }
    } finally {
      synchronized (job) {
        job.updatedAt = Instant.now().toString();
      }
    }
  }

  public Map<String, Object> get(String id) {
    return require(id).snapshot(true);
  }

  public List<Object> list() {
    return jobs.values().stream()
        .sorted(Comparator.comparingLong(job -> -job.sequence))
        .limit(24)
        .map(job -> (Object) job.snapshot(false))
        .toList();
  }

  public Map<String, Object> cancel(String id) {
    Job job = require(id);
    synchronized (job) {
      if (Set.of("completed", "failed", "cancelled").contains(job.state)) return job.snapshot(true);
      job.cancelled = true;
      job.state = "cancelled";
      job.stage = "Отменено пользователем";
      job.updatedAt = Instant.now().toString();
      if (job.future != null) job.future.cancel(true);
      return job.snapshot(false);
    }
  }

  private Job require(String id) {
    Job job = jobs.get(id);
    if (job == null)
      throw new IllegalArgumentException("Задание не найдено или истёк срок хранения");
    return job;
  }

  private void evict() {
    if (jobs.size() < 40) return;
    jobs.values().stream()
        .filter(job -> Set.of("completed", "failed", "cancelled").contains(job.state))
        .sorted(Comparator.comparingLong(job -> job.sequence))
        .limit(16)
        .forEach(job -> jobs.remove(job.id));
  }

  public void close() {
    executor.shutdownNow();
  }
}

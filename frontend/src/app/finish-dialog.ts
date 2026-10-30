import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from './api.service';
import { FAILURE_REASONS } from './models';
import type { Demand, FinishPayload, Outcome } from './models';

const NOTE_MAX = 500;

@Component({
  selector: 'app-finish-dialog',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="finish-title" (cancel)="onCancel($event)" (click)="onBackdrop($event)">
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <h2 id="finish-title">Encerrar demanda #{{ demand().id }}</h2>
        <p class="muted">{{ demand().title }}</p>

        <fieldset>
          <legend>Resultado</legend>
          <label class="radio">
            <input type="radio" formControlName="outcome" value="success" /> Sucesso
          </label>
          <label class="radio">
            <input type="radio" formControlName="outcome" value="failure" /> Insucesso
          </label>
        </fieldset>

        @if (outcome() === 'failure') {
          <div class="field">
            <label for="reason">Motivo do insucesso</label>
            <select
              id="reason"
              formControlName="failureReason"
              [attr.aria-invalid]="reasonInvalid()"
              aria-describedby="reason-error"
            >
              <option value="">Escolha um motivo</option>
              @for (r of reasons; track r.value) {
                <option [value]="r.value">{{ r.label }}</option>
              }
            </select>
            @if (reasonInvalid()) {
              <p id="reason-error" class="field-error">Informe o motivo para registrar o insucesso.</p>
            }
          </div>
        }

        <div class="field">
          <label for="note">Observação <span class="muted">(opcional)</span></label>
          <textarea id="note" rows="4" formControlName="note" [attr.aria-invalid]="noteTooLong()"></textarea>
          <p class="counter" [class.over]="noteTooLong()" aria-live="polite">
            {{ noteLength() }}/{{ noteMax }}
          </p>
        </div>

        @if (error(); as message) {
          <p class="alert error" role="alert">{{ message }}</p>
        }

        <div class="actions">
          <button type="button" class="btn" (click)="dismiss.emit()" [disabled]="submitting()">Cancelar</button>
          <button type="submit" class="btn primary" [disabled]="!canSubmit()">
            {{ submitting() ? 'Encerrando…' : 'Concluir' }}
          </button>
        </div>
      </form>
    </dialog>
  `,
})
export class FinishDialog {
  readonly demand = input.required<Demand>();
  readonly finished = output<Demand>();
  /** O servidor recusou porque o estado mudou (409): devolve o estado atual para atualizar a linha. */
  readonly conflict = output<{ demand: Demand; message: string }>();
  readonly dismiss = output<void>();

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly reasons = FAILURE_REASONS;
  protected readonly noteMax = NOTE_MAX;
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.fb.group({
    outcome: this.fb.control<Outcome>('success', Validators.required),
    failureReason: this.fb.control(''),
    note: this.fb.control('', Validators.maxLength(NOTE_MAX)),
  });

  private readonly formState = toSignal(this.form.events, { initialValue: null });
  private readonly status = computed(() => {
    this.formState(); // dependência: recalcula quando o formulário muda
    return this.form.status;
  });
  protected readonly outcome = computed(() => {
    this.formState();
    return this.form.controls.outcome.value;
  });
  protected readonly noteLength = computed(() => {
    this.formState();
    return this.form.controls.note.value.length;
  });
  protected readonly noteTooLong = computed(() => this.noteLength() > NOTE_MAX);
  protected readonly reasonInvalid = computed(() => {
    this.formState();
    const c = this.form.controls.failureReason;
    return c.invalid && (c.touched || c.dirty);
  });
  protected readonly canSubmit = computed(() => this.status() === 'VALID' && !this.submitting());

  constructor() {
    // Validação condicional: o motivo só é obrigatório quando o resultado é insucesso.
    this.form.controls.outcome.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const reason = this.form.controls.failureReason;
      if (value === 'failure') {
        reason.setValidators(Validators.required);
      } else {
        reason.clearValidators();
        reason.reset('');
      }
      reason.updateValueAndValidity();
    });

    afterNextRender(() => {
      const el = this.dialog().nativeElement;
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', ''); // ambiente sem <dialog> modal (ex.: jsdom)
    });
  }

  protected onCancel(event: Event) {
    event.preventDefault(); // Esc passa pelo mesmo caminho do botão "Cancelar"
    if (!this.submitting()) this.dismiss.emit();
  }

  protected onBackdrop(event: MouseEvent) {
    if (event.target === this.dialog().nativeElement && !this.submitting()) this.dismiss.emit();
  }

  protected submit() {
    if (!this.canSubmit()) {
      this.form.markAllAsTouched();
      return;
    }
    const { outcome, failureReason, note } = this.form.getRawValue();
    const body: FinishPayload = { outcome };
    if (outcome === 'failure') body.failureReason = failureReason;
    const trimmed = note.trim();
    if (trimmed) body.note = trimmed;

    this.submitting.set(true);
    this.error.set(null);
    this.api.finish(this.demand().id, body).subscribe({
      next: (demand) => {
        this.submitting.set(false);
        this.finished.emit(demand);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        const message = err.error?.message ?? 'Não foi possível encerrar. Tente novamente.';
        if ((err.status === 409 || err.status === 403) && err.error?.demand) {
          this.conflict.emit({ demand: err.error.demand, message });
        } else {
          this.error.set(message);
        }
      },
    });
  }
}

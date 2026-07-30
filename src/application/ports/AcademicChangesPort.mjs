/**
 * Novedades desde la última revisión: tareas nuevas, cambios de entrega, notas
 * nuevas y notas que cambiaron. La fuente lleva su propia línea base — cada
 * consulta consume las novedades y deja la marca puesta.
 */
export class AcademicChangesPort {
  /**
   * @returns {Promise<{
   *   firstRun: boolean,
   *   previousAt: number|null,
   *   newTasks: Array<{name:string, courseName:string, dueDate:number|null, submission:string, hidden:boolean}>,
   *   submissionChanges: Array<{task:{name:string, courseName:string}, from:string, to:string}>,
   *   dueDateChanges: Array<{task:{name:string, courseName:string}, from:number|null, to:number|null}>,
   *   newGrades: Array<{courseName:string, item:string, grade:string|null}>,
   *   gradeChanges: Array<{grade:{courseName:string, item:string}, from:string|null, to:string|null}>,
   * }>}
   */
  async pullChanges() {
    throw new Error("not implemented");
  }
}
